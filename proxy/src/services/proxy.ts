import { findChannelForModel, findFallbackChannel } from "./channel.js";
import {
  extractUsageFromResponse,
  extractUsageFromStreamChunk,
  recordUsage,
  type UsageRecord,
} from "./usage.js";

const UPSTREAM_TIMEOUT = 30_000; // 30 秒超时

interface ChatRequest {
  model: string;
  stream?: boolean;
  messages?: unknown[];
  [key: string]: unknown;
}

/**
 * 代理转发核心：构建上游请求并处理响应
 * 支持流式 (SSE) 和非流式两种模式
 */
export async function proxyChatRequest(
  userId: string,
  requestBody: ChatRequest
): Promise<Response> {
  const { model, stream, ...restBody } = requestBody;

  // 1. 查找渠道
  let channel = await findChannelForModel(model);
  if (!channel) {
    return new Response(
      JSON.stringify({
        error: {
          message: `No available channel for model '${model}'. Please configure a channel in admin panel.`,
          type: "no_channel",
        },
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2. 构建上游请求体
  const upstreamBody = JSON.stringify({ model, stream, ...restBody });

  // 3. 尝试转发（含故障切换）
  let response: Response;
  let usedChannel = channel;

  try {
    response = await sendUpstreamRequest(channel, upstreamBody, stream);
  } catch (err) {
    console.error(`Channel ${channel.name} failed, trying fallback:`, err);
    const fallback = await findFallbackChannel(model, channel.id);
    if (!fallback) {
      return new Response(
        JSON.stringify({
          error: {
            message: `All channels failed for model '${model}'`,
            type: "upstream_error",
          },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    usedChannel = fallback;
    try {
      response = await sendUpstreamRequest(fallback, upstreamBody, stream);
    } catch {
      return new Response(
        JSON.stringify({
          error: {
            message: `Upstream request failed: all channels unavailable`,
            type: "upstream_error",
          },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // 4. 处理响应
  if (stream) {
    return handleStreamResponse(response, userId, model, usedChannel.id);
  } else {
    return handleNonStreamResponse(response, userId, model, usedChannel.id);
  }
}

/**
 * 发送请求到上游 API
 */
async function sendUpstreamRequest(
  channel: { baseUrl: string; apiKey: string },
  body: string,
  stream?: boolean
): Promise<Response> {
  const url = `${channel.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${channel.apiKey}`,
  };
  if (stream) {
    headers["Accept"] = "text/event-stream";
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

/**
 * 处理非流式响应
 */
async function handleNonStreamResponse(
  upstreamResponse: Response,
  userId: string,
  model: string,
  channelId: string
): Promise<Response> {
  const bodyText = await upstreamResponse.text();
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // 上游返回的不是 JSON，直接透传
    return new Response(bodyText, {
      status: upstreamResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 提取用量并记录
  const usage = extractUsageFromResponse(parsed, model);
  await recordUsage(userId, model, channelId, usage);

  // 返回原始响应
  return new Response(JSON.stringify(parsed), {
    status: upstreamResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * 处理流式响应（SSE）
 * 逐 chunk 转发给客户端，从最后一个含 usage 的 chunk 提取用量
 */
function handleStreamResponse(
  upstreamResponse: Response,
  userId: string,
  model: string,
  channelId: string
): Response {
  const reader = upstreamResponse.body?.getReader();
  if (!reader) {
    return new Response(
      JSON.stringify({ error: { message: "No response body", type: "stream_error" } }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  let lastUsage: UsageRecord | null = null;
  let buffer = "";

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // 流结束，记录用量
          if (lastUsage) {
            await recordUsage(userId, model, channelId, lastUsage);
          }
          controller.close();
          return;
        }

        // 将 chunk 转发给客户端
        controller.enqueue(value);

        // 从 buffer 中提取 SSE 行，查找 usage
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // 保留最后一个不完整的行

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            const usage = extractUsageFromStreamChunk(data, model);
            if (usage) {
              lastUsage = usage;
            }
          }
        }
      } catch (err) {
        console.error("Stream read error:", err);
        if (lastUsage) {
          await recordUsage(userId, model, channelId, lastUsage);
        }
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
