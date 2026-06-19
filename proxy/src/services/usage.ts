import { randomBytes } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cost: number;
}

function safeTokenCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/**
 * 从 OpenAI 兼容响应中提取 usage 信息。
 *
 * Docker 双服务架构中费用由 web 端根据最新价格表计算，proxy 只上报 token 元数据。
 */
export async function extractUsageFromResponse(
  responseBody: Record<string, unknown>,
  channelId: string,
  model: string
): Promise<UsageRecord> {
  const usage = responseBody.usage as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
    prompt_cache_hit_tokens?: unknown;
    prompt_cache_miss_tokens?: unknown;
    cache_read_input_tokens?: unknown;
  } | undefined;

  if (!usage) {
    console.warn(`[Usage] No usage data in response for model=${model} channel=${channelId}`);
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, cost: 0 };
  }

  const cacheHitTokens =
    safeTokenCount(usage.prompt_tokens_details?.cached_tokens) ||
    safeTokenCount(usage.prompt_cache_hit_tokens) ||
    safeTokenCount(usage.cache_read_input_tokens);
  const cacheMissTokens = safeTokenCount(usage.prompt_cache_miss_tokens);
  const reportedInputTokens = safeTokenCount(usage.prompt_tokens);
  const inputTokens = reportedInputTokens || (cacheHitTokens + cacheMissTokens);
  const outputTokens = safeTokenCount(usage.completion_tokens);
  const reportedTotalTokens = safeTokenCount(usage.total_tokens);
  const totalTokens = reportedTotalTokens || inputTokens + outputTokens;
  const cachedTokens = Math.min(cacheHitTokens, inputTokens);

  if (inputTokens === 0 && outputTokens === 0) {
    console.warn(`[Usage] Zero tokens in response for model=${model} channel=${channelId}`, usage);
  }

  return { inputTokens, outputTokens, totalTokens, cachedTokens, cost: 0 };
}

/**
 * 从 SSE 流式 chunk 中提取 usage。
 */
export async function extractUsageFromStreamChunk(
  chunk: string,
  channelId: string,
  model: string
): Promise<UsageRecord | null> {
  try {
    const parsed = JSON.parse(chunk);
    if (parsed.usage && typeof parsed.usage === "object") {
      return await extractUsageFromResponse(parsed, channelId, model);
    }
  } catch {
    // 非 JSON chunk，忽略。
  }
  return null;
}

interface PendingRecord {
  id: string;
  userId: string;
  model: string;
  channelId: string;
  reservationId?: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cost: number;
  createdAt: number;
}

let pendingRecords: PendingRecord[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let queueLoaded = false;
const FLUSH_INTERVAL_MS = 2_000;
const RETRY_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 50;
const QUEUE_FILE = process.env.USAGE_QUEUE_FILE || "/tmp/ai-token-usage-queue.jsonl";
const DEAD_LETTER_FILE = process.env.USAGE_DEAD_LETTER_FILE || "/tmp/ai-token-usage-dead-letter.jsonl";

interface WritablePathCheck {
  ok: boolean;
  path: string;
  error?: string;
}

function checkWritableFileTarget(filePath: string, probeName: string): WritablePathCheck {
  const targetDir = dirname(filePath);
  const probePath = `${targetDir}/${probeName}`;
  try {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(probePath, String(Date.now()), "utf8");
    unlinkSync(probePath);
    return { ok: true, path: targetDir };
  } catch (err) {
    return {
      ok: false,
      path: targetDir,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function ensureQueueLoaded(): void {
  if (queueLoaded) return;
  queueLoaded = true;
  if (!existsSync(QUEUE_FILE)) return;

  try {
    const loaded = readFileSync(QUEUE_FILE, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PendingRecord);
    if (loaded.length > 0) {
      pendingRecords = [...loaded, ...pendingRecords];
      console.log(`[Usage] Loaded ${loaded.length} persisted usage records`);
    }
  } catch (err) {
    console.error("[Usage] Failed to load persisted usage queue:", err);
  }
}

function appendPersistedRecord(record: PendingRecord): void {
  try {
    mkdirSync(dirname(QUEUE_FILE), { recursive: true });
    appendFileSync(QUEUE_FILE, `${JSON.stringify(record)}\n`, "utf8");
  } catch (err) {
    console.error("[Usage] Failed to persist usage record; record remains in memory only:", err);
  }
}

function rewritePersistedQueue(): void {
  try {
    mkdirSync(dirname(QUEUE_FILE), { recursive: true });
    const tmp = `${QUEUE_FILE}.tmp`;
    const body = pendingRecords.map((record) => JSON.stringify(record)).join("\n");
    writeFileSync(tmp, body ? `${body}\n` : "", "utf8");
    renameSync(tmp, QUEUE_FILE);
  } catch (err) {
    console.error("[Usage] Failed to rewrite persisted usage queue:", err);
  }
}

function appendDeadLetter(batch: PendingRecord[], responseBody: unknown): void {
  try {
    mkdirSync(dirname(DEAD_LETTER_FILE), { recursive: true });
    appendFileSync(
      DEAD_LETTER_FILE,
      `${JSON.stringify({ createdAt: Date.now(), response: responseBody, records: batch })}\n`,
      "utf8"
    );
  } catch (err) {
    console.error("[Usage] Failed to persist usage dead-letter records:", err);
  }
}

function scheduleFlush(delay = FLUSH_INTERVAL_MS): void {
  if (!flushTimer) {
    flushTimer = setTimeout(flushUsageToWeb, delay);
  }
}

/**
 * 通过 HTTP POST 将用量记录转发到 web 端。
 * 失败时保留队列并重试，避免计费数据因为短暂故障直接丢失。
 */
export async function flushUsageToWeb(): Promise<void> {
  ensureQueueLoaded();
  if (pendingRecords.length === 0) return;
  flushTimer = null;

  const batch = pendingRecords.slice(0, MAX_BATCH_SIZE);
  const webUrl = (process.env.WEB_URL || "http://web:3000").replace(/\/+$/, "");
  const internalKey = process.env.INTERNAL_API_KEY;

  if (!internalKey) {
    console.error("[Usage] INTERNAL_API_KEY not set, usage records are queued and will retry");
    scheduleFlush(RETRY_INTERVAL_MS);
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
      signal: AbortSignal.timeout(10_000),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(`[Usage] Failed to flush ${batch.length} records (${res.status}): ${text}. Pending=${pendingRecords.length}`);
      scheduleFlush(RETRY_INTERVAL_MS);
      return;
    }

    if (text) {
      try {
        const parsed = JSON.parse(text) as {
          rejected?: number;
          rejectedRecords?: Array<{ id?: string }>;
        };
        const rejectedIds = new Set(
          (parsed.rejectedRecords || [])
            .map((record) => record.id)
            .filter((id): id is string => Boolean(id))
        );
        const rejectedCount = Number(parsed.rejected ?? 0);
        if (rejectedCount > 0 || rejectedIds.size > 0) {
          const rejectedBatch = rejectedIds.size > 0 && rejectedIds.size >= rejectedCount
            ? batch.filter((record) => rejectedIds.has(record.id))
            : batch;
          console.error(`[Usage] Web rejected ${rejectedBatch.length} usage records; moved to dead-letter file and removed from retry queue`);
          appendDeadLetter(rejectedBatch, parsed);
          pendingRecords = pendingRecords.slice(batch.length);
          rewritePersistedQueue();
          if (pendingRecords.length > 0) scheduleFlush(FLUSH_INTERVAL_MS);
          return;
        }
      } catch {
        // Older web endpoints may return a non-JSON success body.
      }
    }

    pendingRecords.splice(0, batch.length);
    rewritePersistedQueue();
  } catch (err) {
    console.error(`[Usage] Flush error (${batch.length} records):`, err, `Pending=${pendingRecords.length}`);
    scheduleFlush(RETRY_INTERVAL_MS);
    return;
  }

  if (pendingRecords.length > 0) {
    scheduleFlush(FLUSH_INTERVAL_MS);
  }
}

export async function recordUsage(
  userId: string,
  model: string,
  channelId: string,
  usage: UsageRecord,
  reservationId?: string | null
): Promise<void> {
  ensureQueueLoaded();
  if (usage.totalTokens === 0) return;

  const record = {
    id: randomBytes(8).toString("hex"),
    userId,
    model,
    channelId,
    reservationId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedTokens: usage.cachedTokens,
    cost: usage.cost,
    createdAt: Date.now(),
  };
  pendingRecords.push(record);
  appendPersistedRecord(record);

  if (pendingRecords.length >= MAX_BATCH_SIZE) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushUsageToWeb();
    return;
  }

  scheduleFlush(FLUSH_INTERVAL_MS);
}

export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateUsage(input: unknown, output: unknown): UsageRecord {
  const inputTokens = estimateTokens(input);
  const outputTokens = estimateTokens(output);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedTokens: 0,
    cost: 0,
  };
}

export function getUsageQueueHealth() {
  ensureQueueLoaded();
  const queueWritable = checkWritableFileTarget(QUEUE_FILE, ".sparkloom-proxy-queue-write-check");
  const deadLetterWritable = checkWritableFileTarget(DEAD_LETTER_FILE, ".sparkloom-proxy-dead-letter-write-check");
  return {
    pendingRecords: pendingRecords.length,
    queueFile: QUEUE_FILE,
    deadLetterFile: DEAD_LETTER_FILE,
    persistedQueueConfigured: Boolean(QUEUE_FILE),
    queueWritable,
    deadLetterWritable,
  };
}

export function clearUsageQueue(): { clearedPendingRecords: number; queueFile: string; deadLetterFile: string } {
  ensureQueueLoaded();
  const clearedPendingRecords = pendingRecords.length;
  pendingRecords = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  rewritePersistedQueue();
  return {
    clearedPendingRecords,
    queueFile: QUEUE_FILE,
    deadLetterFile: DEAD_LETTER_FILE,
  };
}
