import { findChannelForModel, findFallbackChannel, type ChannelInfo } from "./channel.js";
import { fromClaudeGatewayModelId } from "./model-alias.js";
import { estimateTokens, recordUsage, type UsageRecord } from "./usage.js";
import { assertSafeUpstreamBaseUrl } from "./upstream-safety.js";
import { checkUserQuota, releaseQuotaReservation } from "./web-internal.js";

const ANTHROPIC_VERSION = "2023-06-01";
const UPSTREAM_TIMEOUT = 300_000;

interface AnthropicRequest {
  model: string;
  stream?: boolean;
  [key: string]: unknown;
}

interface AnthropicClientHeaders {
  anthropicVersion?: string;
  anthropicBeta?: string;
}

function normalizeModelForBilling(model: string): string {
  return fromClaudeGatewayModelId(model).replace(/\[[^\]]+\]$/, "");
}

function safeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function anthropicPathFor(baseUrl: URL, endpoint: "messages" | "count_tokens"): string {
  const cleanPath = baseUrl.pathname.replace(/\/+$/, "");
  const suffix = endpoint === "messages" ? "messages" : "messages/count_tokens";

  if (baseUrl.hostname.toLowerCase().includes("deepseek") && !cleanPath.includes("/anthropic")) {
    return `${cleanPath}/anthropic/v1/${suffix}`.replace(/\/{2,}/g, "/");
  }
  if (cleanPath.endsWith("/v1")) {
    return `${cleanPath}/${suffix}`;
  }
  return `${cleanPath}/v1/${suffix}`.replace(/\/{2,}/g, "/");
}

function buildAnthropicUrl(baseUrl: URL, endpoint: "messages" | "count_tokens"): URL {
  const url = new URL(baseUrl.toString());
  url.pathname = anthropicPathFor(baseUrl, endpoint);
  url.search = "";
  url.hash = "";
  return url;
}

function usageFromAnthropicBody(body: Record<string, unknown>): UsageRecord {
  const usage = body.usage as Record<string, unknown> | undefined;
  if (!usage) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, cost: 0 };
  }

  const inputTokens = safeInt(Number(usage.input_tokens ?? 0));
  const outputTokens = safeInt(Number(usage.output_tokens ?? 0));
  const cacheRead = safeInt(Number(usage.cache_read_input_tokens ?? 0));
  const cacheCreated = safeInt(Number(usage.cache_creation_input_tokens ?? 0));
  const cachedTokens = Math.min(cacheRead + cacheCreated, inputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedTokens,
    cost: 0,
  };
}

function estimateAnthropicUsage(requestBody: unknown, responseBody: unknown): UsageRecord {
  const inputTokens = estimateTokens(requestBody);
  const outputTokens = estimateTokens(responseBody);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedTokens: 0,
    cost: 0,
  };
}

function jsonError(status: number, type: string, message: string, extra?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ type: "error", error: { type, message, ...(extra || {}) } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function isModelUnavailableError(status: number, bodyText: string): boolean {
  if (![400, 404, 422].includes(status)) return false;
  return /1211|模型不存在|model[^"'，。]*不存在|model[^"'，。]*(not found|not exist|does not exist|invalid)/i.test(bodyText);
}

function passThroughTextResponse(upstreamResponse: Response, bodyText: string): Response {
  return new Response(bodyText, {
    status: upstreamResponse.status,
    headers: { "Content-Type": upstreamResponse.headers.get("content-type") || "application/json" },
  });
}

function reserveOutputTokens(requestBody: AnthropicRequest): number {
  const parsedCap = Number(process.env.QUOTA_MAX_OUTPUT_TOKEN_RESERVE ?? 8192);
  const cap = Number.isFinite(parsedCap) && parsedCap > 0 ? Math.ceil(parsedCap) : 8192;
  const explicit = Number(requestBody.max_tokens);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(Math.ceil(explicit), cap);

  const fallback = Number(process.env.QUOTA_DEFAULT_OUTPUT_TOKEN_RESERVE ?? 2000);
  const reserve = Number.isFinite(fallback) && fallback > 0 ? Math.ceil(fallback) : 2000;
  return Math.min(reserve, cap);
}

async function reserveQuotaForChannel(
  userId: string,
  channel: ChannelInfo,
  billingModel: string,
  requestBody: AnthropicRequest
): Promise<{ reservationId: string | null; estimatedInputTokens: number } | Response> {
  const estimatedInputTokens = estimateTokens(requestBody);
  const estimatedOutputTokens = reserveOutputTokens(requestBody);
  const quota = await checkUserQuota(userId, {
    channelId: channel.id,
    model: billingModel,
    estimatedInputTokens,
    estimatedOutputTokens,
  });

  if (!quota.ok) {
    const status = quota.type === "pricing_error" ? 422 : quota.type === "auth_error" ? 401 : 429;
    return jsonError(status, quota.type || "quota_error", quota.message || "Quota check failed", {
      quotaInfo: quota.quotaInfo,
    });
  }

  return {
    reservationId: quota.reservationId ?? null,
    estimatedInputTokens,
  };
}

async function sendAnthropicRequest(
  channel: ChannelInfo,
  body: string,
  endpoint: "messages" | "count_tokens",
  stream: boolean,
  clientHeaders: AnthropicClientHeaders
): Promise<Response> {
  const baseUrl = await assertSafeUpstreamBaseUrl(channel.baseUrl);
  const url = buildAnthropicUrl(baseUrl, endpoint);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": channel.apiKey,
    Authorization: `Bearer ${channel.apiKey}`,
    "anthropic-version": clientHeaders.anthropicVersion || ANTHROPIC_VERSION,
  };
  if (clientHeaders.anthropicBeta) {
    headers["anthropic-beta"] = clientHeaders.anthropicBeta;
  }
  if (stream) {
    headers.Accept = "text/event-stream";
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
  });

  if (!response.ok && (response.status >= 500 || response.status === 429)) {
    const errorText = await response.text();
    throw new Error(`Upstream ${response.status}: ${errorText.slice(0, 300)}`);
  }

  return response;
}

async function findAnthropicChannel(model: string): Promise<{ channel: ChannelInfo | null; billingModel: string }> {
  const billingModel = normalizeModelForBilling(model);
  const channel = await findChannelForModel(model) || await findChannelForModel(billingModel);
  return { channel, billingModel };
}

async function tryFallbackAnthropicChannels(
  userId: string,
  billingModel: string,
  upstreamRequestBody: AnthropicRequest,
  upstreamBody: string,
  stream: boolean,
  clientHeaders: AnthropicClientHeaders,
  failedChannelId: string
): Promise<{ response: Response; usedChannel: ChannelInfo; reservationId: string | null; estimatedInputTokens: number } | Response | null> {
  let excludeChannelId = failedChannelId;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const fallback = await findFallbackChannel(billingModel, excludeChannelId);
    if (!fallback) return null;

    const fallbackReservation = await reserveQuotaForChannel(userId, fallback, billingModel, upstreamRequestBody);
    if (fallbackReservation instanceof Response) return fallbackReservation;

    try {
      const fallbackResponse = await sendAnthropicRequest(fallback, upstreamBody, "messages", stream, clientHeaders);
      if (!fallbackResponse.ok) {
        const fallbackText = await fallbackResponse.text();
        await releaseQuotaReservation(fallbackReservation.reservationId);
        if (isModelUnavailableError(fallbackResponse.status, fallbackText)) {
          console.warn(`[Anthropic] Fallback channel ${fallback.name} does not support model=${billingModel}; trying next channel`);
          excludeChannelId = fallback.id;
          continue;
        }
        return passThroughTextResponse(fallbackResponse, fallbackText);
      }

      return {
        response: fallbackResponse,
        usedChannel: fallback,
        reservationId: fallbackReservation.reservationId,
        estimatedInputTokens: fallbackReservation.estimatedInputTokens,
      };
    } catch (fallbackErr) {
      await releaseQuotaReservation(fallbackReservation.reservationId);
      console.error(`[Anthropic] Fallback ${fallback.name} failed:`, fallbackErr);
      excludeChannelId = fallback.id;
    }
  }

  return null;
}

export async function proxyAnthropicMessagesRequest(
  userId: string,
  requestBody: AnthropicRequest,
  clientHeaders: AnthropicClientHeaders
): Promise<Response> {
  const { model, stream } = requestBody;
  const { channel, billingModel } = await findAnthropicChannel(model);
  if (!channel) {
    return jsonError(404, "not_found_error", `No available channel for model '${model}'. Please configure it in admin panel.`);
  }

  const upstreamRequestBody = { ...requestBody, model: billingModel };
  const upstreamBody = JSON.stringify(upstreamRequestBody);
  let reservation = await reserveQuotaForChannel(userId, channel, billingModel, upstreamRequestBody);
  if (reservation instanceof Response) return reservation;

  let response: Response;
  let usedChannel = channel;
  let reservationId = reservation.reservationId;
  let estimatedInputTokens = reservation.estimatedInputTokens;

  try {
    response = await sendAnthropicRequest(channel, upstreamBody, "messages", Boolean(stream), clientHeaders);
  } catch (err) {
    await releaseQuotaReservation(reservationId);
    console.error(`[Anthropic] Channel ${channel.name} failed, trying fallback:`, err);

    const fallback = await findFallbackChannel(billingModel, channel.id);
    if (!fallback) {
      return jsonError(502, "api_error", "Upstream request failed: all channels unavailable");
    }

    const fallbackReservation = await reserveQuotaForChannel(userId, fallback, billingModel, upstreamRequestBody);
    if (fallbackReservation instanceof Response) return fallbackReservation;

    usedChannel = fallback;
    reservationId = fallbackReservation.reservationId;
    estimatedInputTokens = fallbackReservation.estimatedInputTokens;

    try {
      response = await sendAnthropicRequest(fallback, upstreamBody, "messages", Boolean(stream), clientHeaders);
    } catch (fallbackErr) {
      await releaseQuotaReservation(reservationId);
      console.error(`[Anthropic] Fallback ${fallback.name} failed:`, fallbackErr);
      return jsonError(502, "api_error", "Upstream request failed: all channels unavailable");
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    await releaseQuotaReservation(reservationId);

    if (isModelUnavailableError(response.status, errorText)) {
      console.warn(`[Anthropic] Channel ${usedChannel.name} does not support model=${billingModel}; trying fallback channel`);
      const fallbackResult = await tryFallbackAnthropicChannels(
        userId,
        billingModel,
        upstreamRequestBody,
        upstreamBody,
        Boolean(stream),
        clientHeaders,
        usedChannel.id
      );

      if (fallbackResult instanceof Response) return fallbackResult;
      if (fallbackResult) {
        response = fallbackResult.response;
        usedChannel = fallbackResult.usedChannel;
        reservationId = fallbackResult.reservationId;
        estimatedInputTokens = fallbackResult.estimatedInputTokens;
      } else {
        return passThroughTextResponse(response, errorText);
      }
    } else {
      return passThroughTextResponse(response, errorText);
    }
  }
  if (stream) {
    return handleAnthropicStream(response, userId, billingModel, usedChannel.id, estimatedInputTokens, reservationId);
  }
  return handleAnthropicJson(response, userId, billingModel, usedChannel.id, upstreamRequestBody, reservationId);
}

export async function proxyAnthropicCountTokensRequest(
  requestBody: AnthropicRequest,
  _clientHeaders: AnthropicClientHeaders
): Promise<Response> {
  // Avoid unmetered upstream calls from count_tokens. This endpoint is used by
  // Anthropic-compatible clients for sizing; it should not consume provider keys.
  return new Response(JSON.stringify({ input_tokens: estimateTokens({ ...requestBody, model: normalizeModelForBilling(requestBody.model) }) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleAnthropicJson(
  upstreamResponse: Response,
  userId: string,
  model: string,
  channelId: string,
  requestBody: AnthropicRequest,
  reservationId: string | null
): Promise<Response> {
  const bodyText = await upstreamResponse.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    await releaseQuotaReservation(reservationId);
    return new Response(bodyText, {
      status: upstreamResponse.status,
      headers: { "Content-Type": upstreamResponse.headers.get("content-type") || "application/json" },
    });
  }

  let usage = usageFromAnthropicBody(parsed);
  if (usage.totalTokens === 0) {
    console.warn(`[Anthropic] Upstream omitted usage for model=${model}; recording estimated usage`);
    usage = estimateAnthropicUsage(requestBody, parsed);
  }
  await recordUsage(userId, model, channelId, usage, reservationId);

  return new Response(JSON.stringify(parsed), {
    status: upstreamResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

function handleAnthropicStream(
  upstreamResponse: Response,
  userId: string,
  model: string,
  channelId: string,
  estimatedInputTokens: number,
  reservationId: string | null
): Response {
  const reader = upstreamResponse.body?.getReader();
  if (!reader) {
    releaseQuotaReservation(reservationId).catch((err) =>
      console.error("[Anthropic] Reservation release failed:", err)
    );
    return jsonError(502, "api_error", "No response body");
  }

  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let streamedChars = 0;
  let usageRecorded = false;

  async function recordCollectedUsage(reason: string) {
    if (usageRecorded) return;
    usageRecorded = true;
    const safeInput = inputTokens || estimatedInputTokens;
    const safeOutput = outputTokens || Math.max(1, Math.ceil(streamedChars / 4));
    if (!inputTokens || !outputTokens) {
      console.warn(`[Anthropic] Stream ${reason} without complete usage for model=${model}; recording estimated usage`);
    }
    await recordUsage(userId, model, channelId, {
      inputTokens: safeInput,
      outputTokens: safeOutput,
      totalTokens: safeInput + safeOutput,
      cachedTokens: Math.min(cachedTokens, safeInput),
      cost: 0,
    }, reservationId);
  }

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await recordCollectedUsage("ended");
          controller.close();
          return;
        }

        controller.enqueue(value);
        const decoded = new TextDecoder().decode(value);
        streamedChars += decoded.length;
        buffer += decoded;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const usage = usageFromAnthropicBody(parsed);
            if (usage.inputTokens > 0) inputTokens = usage.inputTokens;
            if (usage.outputTokens > 0) outputTokens = usage.outputTokens;
            if (usage.cachedTokens > 0) cachedTokens = usage.cachedTokens;
          } catch {
            // Ignore non-JSON SSE data.
          }
        }
      } catch (err) {
        console.error("[Anthropic] Stream read error:", err);
        await recordCollectedUsage("errored");
        controller.error(err);
      }
    },
    cancel() {
      recordCollectedUsage("cancelled").catch((err) =>
        console.error("[Anthropic] Stream cancel usage record failed:", err)
      );
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": upstreamResponse.headers.get("content-type") || "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
