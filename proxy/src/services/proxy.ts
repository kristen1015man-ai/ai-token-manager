import { findChannelForModel, findFallbackChannel, type ChannelInfo } from "./channel.js";
import {
  extractUsageFromResponse,
  extractUsageFromStreamChunk,
  estimateTokens,
  estimateUsage,
  recordUsage,
  type UsageRecord,
} from "./usage.js";
import { assertSafeUpstreamBaseUrl } from "./upstream-safety.js";
import { checkUserQuota, releaseQuotaReservation } from "./web-internal.js";

const UPSTREAM_TIMEOUT = 30_000;

interface ChatRequest {
  model: string;
  stream?: boolean;
  messages?: unknown[];
  [key: string]: unknown;
}

function jsonError(status: number, message: string, type: string, extra?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ error: { message, type, ...(extra || {}) } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function reserveOutputTokens(requestBody: Record<string, unknown>): number {
  const parsedCap = Number(process.env.QUOTA_MAX_OUTPUT_TOKEN_RESERVE ?? 8192);
  const cap = Number.isFinite(parsedCap) && parsedCap > 0 ? Math.ceil(parsedCap) : 8192;
  const explicit = Number(requestBody.max_completion_tokens ?? requestBody.max_tokens);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(Math.ceil(explicit), cap);

  const fallback = Number(process.env.QUOTA_DEFAULT_OUTPUT_TOKEN_RESERVE ?? 2000);
  const reserve = Number.isFinite(fallback) && fallback > 0 ? Math.ceil(fallback) : 2000;
  return Math.min(reserve, cap);
}

async function reserveQuotaForChannel(
  userId: string,
  channel: ChannelInfo,
  model: string,
  requestPayload: Record<string, unknown>
): Promise<{ reservationId: string | null; estimatedInputTokens: number } | Response> {
  const estimatedInputTokens = estimateTokens(requestPayload);
  const estimatedOutputTokens = reserveOutputTokens(requestPayload);
  const quota = await checkUserQuota(userId, {
    channelId: channel.id,
    model,
    estimatedInputTokens,
    estimatedOutputTokens,
  });

  if (!quota.ok) {
    const status = quota.type === "pricing_error" ? 422 : quota.type === "auth_error" ? 401 : 429;
    return jsonError(status, quota.message || "Quota check failed", quota.type || "quota_error", {
      quotaInfo: quota.quotaInfo,
    });
  }

  return {
    reservationId: quota.reservationId ?? null,
    estimatedInputTokens,
  };
}

export async function proxyChatRequest(
  userId: string,
  requestBody: ChatRequest
): Promise<Response> {
  const { model, stream, ...restBody } = requestBody;

  let channel = await findChannelForModel(model);
  if (!channel) {
    return jsonError(404, `No available channel for model '${model}'. Please configure a channel in admin panel.`, "no_channel");
  }

  const upstreamPayload: Record<string, unknown> = { model, stream, ...restBody };
  if (stream) {
    const streamOptions = typeof restBody.stream_options === "object" && restBody.stream_options !== null
      ? restBody.stream_options as Record<string, unknown>
      : {};
    upstreamPayload.stream_options = { ...streamOptions, include_usage: true };
  }
  const upstreamBody = JSON.stringify(upstreamPayload);

  let reservation = await reserveQuotaForChannel(userId, channel, model, upstreamPayload);
  if (reservation instanceof Response) return reservation;

  let response: Response;
  let usedChannel = channel;
  let reservationId = reservation.reservationId;
  let estimatedInputTokens = reservation.estimatedInputTokens;

  try {
    response = await sendUpstreamRequest(channel, upstreamBody, stream);
  } catch (err) {
    await releaseQuotaReservation(reservationId);
    console.error(`Channel ${channel.name} failed, trying fallback:`, err);

    const fallback = await findFallbackChannel(model, channel.id);
    if (!fallback) {
      return jsonError(502, `All channels failed for model '${model}'`, "upstream_error");
    }

    const fallbackReservation = await reserveQuotaForChannel(userId, fallback, model, upstreamPayload);
    if (fallbackReservation instanceof Response) return fallbackReservation;

    usedChannel = fallback;
    reservationId = fallbackReservation.reservationId;
    estimatedInputTokens = fallbackReservation.estimatedInputTokens;

    try {
      response = await sendUpstreamRequest(fallback, upstreamBody, stream);
    } catch (fallbackErr) {
      await releaseQuotaReservation(reservationId);
      console.error(`[Proxy] Fallback channel ${fallback.name} also failed:`, fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
      return jsonError(502, "Upstream request failed: all channels unavailable", "upstream_error");
    }
  }

  if (stream) {
    return handleStreamResponse(response, userId, model, usedChannel.id, estimatedInputTokens, reservationId);
  }
  return handleNonStreamResponse(response, userId, model, usedChannel.id, upstreamPayload, reservationId);
}

async function sendUpstreamRequest(
  channel: { baseUrl: string; apiKey: string },
  body: string,
  stream?: boolean
): Promise<Response> {
  const baseUrl = await assertSafeUpstreamBaseUrl(channel.baseUrl);
  const url = new URL(baseUrl.toString());
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/chat/completions`;
  url.search = "";
  url.hash = "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${channel.apiKey}`,
  };
  if (stream) {
    headers.Accept = "text/event-stream";
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Upstream ${resp.status}: ${errorText.slice(0, 200)}`);
  }

  return resp;
}

async function handleNonStreamResponse(
  upstreamResponse: Response,
  userId: string,
  model: string,
  channelId: string,
  requestPayload: Record<string, unknown>,
  reservationId: string | null
): Promise<Response> {
  const bodyText = await upstreamResponse.text();
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(bodyText);
  } catch (err) {
    await releaseQuotaReservation(reservationId);
    console.warn("[Proxy] Upstream response is not JSON, passing through:", err instanceof Error ? err.message : String(err));
    return new Response(bodyText, {
      status: upstreamResponse.status,
      headers: { "Content-Type": upstreamResponse.headers.get("content-type") || "application/json" },
    });
  }

  let usage = await extractUsageFromResponse(parsed, channelId, model);
  if (usage.totalTokens === 0) {
    console.warn(`[Proxy] Upstream omitted usage for model=${model}; recording estimated usage`);
    usage = estimateUsage(requestPayload, parsed);
  }
  await recordUsage(userId, model, channelId, usage, reservationId);

  return new Response(JSON.stringify(parsed), {
    status: upstreamResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

function handleStreamResponse(
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
      console.error("Stream reservation release failed:", err)
    );
    return jsonError(502, "No response body", "stream_error");
  }

  let lastUsage: UsageRecord | null = null;
  let buffer = "";
  let streamedChars = 0;
  let usageRecorded = false;

  async function recordCollectedUsage(reason: string) {
    if (usageRecorded) return;
    usageRecorded = true;
    if (lastUsage) {
      await recordUsage(userId, model, channelId, lastUsage, reservationId);
      return;
    }
    const outputTokens = Math.max(1, Math.ceil(streamedChars / 4));
    console.warn(`[Proxy] Stream ${reason} without usage for model=${model}; recording estimated usage`);
    await recordUsage(userId, model, channelId, {
      inputTokens: estimatedInputTokens,
      outputTokens,
      totalTokens: estimatedInputTokens + outputTokens,
      cachedTokens: 0,
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
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            const usage = await extractUsageFromStreamChunk(data, channelId, model);
            if (usage) {
              lastUsage = usage;
            }
          }
        }
      } catch (err) {
        console.error("Stream read error:", err);
        await recordCollectedUsage("errored");
        controller.error(err);
      }
    },
    cancel() {
      recordCollectedUsage("cancelled").catch((err) =>
        console.error("Stream cancel usage record failed:", err)
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
