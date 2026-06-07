import { randomBytes } from "crypto";
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

  // UE-01: 上游未返回 usage 时记录警告，避免静默丢失计费数据
  if (!usage) {
    console.warn(`[Usage] No usage data in response for model=${model} channel=${channelId}`);
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 };
  }

  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;

  // UE-01: 全零 usage 记录警告（可能是上游异常）
  if (inputTokens === 0 && outputTokens === 0) {
    console.warn(`[Usage] Zero tokens in response for model=${model} channel=${channelId}`, usage);
  }

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
    // UE-02: 严格检查 usage 是否为有效对象
    if (parsed.usage && typeof parsed.usage === "object") {
      return await extractUsageFromResponse(parsed, channelId, model);
    }
  } catch {
    // 不是 JSON，忽略
  }
  return null;
}

/** 用量记录缓冲区 — 批量发送减少 HTTP 请求 */
interface PendingRecord {
  id: string;
  userId: string;
  model: string;
  channelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  createdAt: number;
}

let pendingRecords: PendingRecord[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lostRecordCount = 0; // 统计因 flush 失败丢弃的记录数
const FLUSH_INTERVAL_MS = 2000; // 2秒批量发送一次
const MAX_BATCH_SIZE = 50; // 单次最多发送条数

/**
 * 通过 HTTP POST 将用量记录转发到 web 端
 * 单写者架构：只有 web 进程写 SQLite，避免双进程竞态
 */
export async function flushUsageToWeb(): Promise<void> {
  if (pendingRecords.length === 0) return;

  // 取出待发送记录，清空缓冲区
  const batch = pendingRecords.splice(0, MAX_BATCH_SIZE);
  // 如果缓冲区还有剩余，安排下一次 flush
  if (pendingRecords.length > 0) {
    flushTimer = setTimeout(flushUsageToWeb, FLUSH_INTERVAL_MS);
  } else {
    flushTimer = null;
  }

  const webUrl = process.env.WEB_URL || "http://localhost:3000";
  const internalKey = process.env.INTERNAL_API_KEY;

  if (!internalKey) {
    console.error("[Usage] INTERNAL_API_KEY not set, usage records will be lost");
    return;
  }

  try {
    const res = await fetch(`${webUrl}/api/internal/usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalKey}`,
      },
      body: JSON.stringify({ records: batch }),
    });

    if (!res.ok) {
      const text = await res.text();
      lostRecordCount += batch.length;
      console.error(`[Usage] Failed to flush ${batch.length} records (${res.status}): ${text}. 累计丢失: ${lostRecordCount}`);
    }
  } catch (err) {
    lostRecordCount += batch.length;
    console.error(`[Usage] Flush error (${batch.length} records):`, err, `累计丢失: ${lostRecordCount}`);
  }
}

/**
 * 写入用量记录（缓冲 + 批量发送到 web）
 */
export async function recordUsage(
  userId: string,
  model: string,
  channelId: string,
  usage: UsageRecord
): Promise<void> {
  if (usage.totalTokens === 0) return; // 跳过 0 token 记录

  const record: PendingRecord = {
    id: randomBytes(8).toString("hex"),
    userId,
    model,
    channelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cost: usage.cost,
    createdAt: Date.now(),
  };

  pendingRecords.push(record);

  // 缓冲区满 → 立即发送
  if (pendingRecords.length >= MAX_BATCH_SIZE) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushUsageToWeb();
    return;
  }

  // 首条记录 → 启动定时器
  if (!flushTimer) {
    flushTimer = setTimeout(flushUsageToWeb, FLUSH_INTERVAL_MS);
  }
}
