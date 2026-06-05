import { randomBytes } from "crypto";
import { getDb, saveDb } from "../../../shared/db.js";
import { usageLogs } from "../../../shared/schema.js";
import { calculateCost } from "../utils/pricing.js";

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

/**
 * 从 OpenAI 兼容响应中提取 usage 信息
 * channelId 用于「渠道+模型」组合定价查找
 */
export async function extractUsageFromResponse(
  responseBody: Record<string, unknown>,
  channelId: string,
  model: string
): Promise<UsageRecord> {
  const usage = responseBody.usage as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | undefined;

  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;

  const cost = await calculateCost(channelId, model, inputTokens, outputTokens, cachedTokens);

  return { inputTokens, outputTokens, totalTokens, cost };
}

/**
 * 从 SSE 流式 chunk 中提取 usage
 * 流式响应在最后一个 data chunk 中包含 usage 字段
 */
export async function extractUsageFromStreamChunk(
  chunk: string,
  channelId: string,
  model: string
): Promise<UsageRecord | null> {
  try {
    const parsed = JSON.parse(chunk);
    if (parsed.usage) {
      return await extractUsageFromResponse(parsed, channelId, model);
    }
  } catch {
    // 不是 JSON，忽略
  }
  return null;
}

/**
 * 写入用量记录到数据库
 */
export async function recordUsage(
  userId: string,
  model: string,
  channelId: string,
  usage: UsageRecord
): Promise<void> {
  if (usage.totalTokens === 0) return; // 跳过 0 token 记录

  try {
    const { db } = await getDb();
    await db.insert(usageLogs).values({
      id: randomBytes(8).toString("hex"),
      userId,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cost: usage.cost,
      channelId,
      createdAt: new Date(),
    });
    await saveDb();
  } catch (err) {
    console.error("Failed to record usage:", err);
    // 用量记录失败不应阻断用户请求
  }
}
