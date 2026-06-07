/**
 * proxy/streaming.ts — 用量提取、用量记录、流式/非流式响应处理
 */
import { randomBytes } from "crypto";
import { getDb, scheduleSave } from "../db";
import { usageLogs } from "../../../../shared/schema";
import { calculateCost } from "./cache";

// ========== 用量记录类型 ==========

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

// ========== 用量提取 ==========

export async function extractUsage(responseBody: Record<string, unknown>, channelId: string, model: string): Promise<UsageRecord> {
  const usage = responseBody.usage as {
    prompt_tokens?: number; completion_tokens?: number; total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | undefined;

  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const cost = await calculateCost(channelId, model, inputTokens, outputTokens, cachedTokens);

  return { inputTokens, outputTokens, totalTokens, cost };
}

// ========== 用量记录写入 ==========

export async function recordUsage(userId: string, model: string, channelId: string, usage: UsageRecord) {
  if (usage.totalTokens === 0) return;
  try {
    const { db } = await getDb();
    await db.insert(usageLogs).values({
      id: `log_${randomBytes(8).toString("hex")}`,
      userId, model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cost: usage.cost,
      channelId,
      createdAt: new Date(),
    });
    scheduleSave(); // 延迟批量写入，避免每次请求都落盘
  } catch (err) {
    console.error("[Proxy] 记录用量失败:", err);
  }
}

// ========== 非流式响应 ==========

export async function handleNonStreamResponse(
  upstreamResponse: Response, userId: string, model: string, channelId: string
): Promise<Response> {
  const bodyText = await upstreamResponse.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    console.warn("[Proxy] 上游响应非 JSON，原始透传");
    return new Response(bodyText, {
      status: upstreamResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 提取用量并记录（传入 channelId 用于渠道定价查找）
  const usage = await extractUsage(parsed, channelId, model);
  await recordUsage(userId, model, channelId, usage);

  return new Response(JSON.stringify(parsed), {
    status: upstreamResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

// ========== 流式响应（SSE） ==========

export function handleStreamResponse(
  upstreamResponse: Response, userId: string, model: string, channelId: string
): Response {
  const reader = upstreamResponse.body?.getReader();
  if (!reader) {
    return Response.json({ error: { message: "上游无响应体", type: "stream_error" } }, { status: 502 });
  }

  let lastUsage: UsageRecord | null = null;
  let buffer = "";

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (lastUsage) await recordUsage(userId, model, channelId, lastUsage);
          controller.close();
          return;
        }

        controller.enqueue(value);

        // 从 SSE 行中提取 usage
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.usage) lastUsage = await extractUsage(parsed, channelId, model);
            } catch { /* 忽略非 JSON 行 */ }
          }
        }
      } catch (err) {
        console.error("[Proxy] 流读取错误:", err);
        if (lastUsage) await recordUsage(userId, model, channelId, lastUsage);
        controller.error(err);
      }
    },
    cancel() {
      // 客户端断开，记录已收集的用量
      if (lastUsage) {
        recordUsage(userId, model, channelId, lastUsage).catch((err) =>
          console.error("[Proxy] Stream cancel 用量记录失败:", err)
        );
      }
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
