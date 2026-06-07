/**
 * proxy/cache.ts — 定价缓存、渠道缓存、限额缓存、费用计算
 */
import { getDb } from "../db";
import { channels, quotaRules, modelPrices } from "../../../../shared/schema";
import { eq, type InferSelectModel } from "drizzle-orm";
import { ensureDecrypted } from "../crypto";

// ========== 定价表（从数据库读取，60秒缓存，渠道+模型复合键） ==========

const FALLBACK_PRICES: Record<string, { input: number; output: number; cache: number }> = {
  "deepseek-chat": { input: 1.0, output: 2.0, cache: 0.1 },
  "deepseek-reasoner": { input: 4.0, output: 16.0, cache: 0.4 },
};

// key 格式："channelId:model" 或 ":model"（全局价格）
let priceCache: Map<string, { input: number; output: number; cache: number }> | null = null;
let cacheExpireAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadPriceTable(): Promise<Map<string, { input: number; output: number; cache: number }>> {
  const now = Date.now();
  if (priceCache && now < cacheExpireAt) return priceCache;

  try {
    const { db } = await getDb();
    const rows = await db.select().from(modelPrices);
    const map = new Map<string, { input: number; output: number; cache: number }>();
    for (const row of rows) {
      const key = `${row.channelId ?? ""}:${row.model}`;
      map.set(key, {
        input: row.inputPerMillion,
        output: row.outputPerMillion,
        cache: row.cachePerMillion,
      });
    }
    priceCache = map;
    cacheExpireAt = now + CACHE_TTL_MS;
    return map;
  } catch (err) {
    console.error("[Proxy] 加载价格表失败，使用 fallback:", err);
    const map = new Map<string, { input: number; output: number; cache: number }>();
    for (const [model, price] of Object.entries(FALLBACK_PRICES)) {
      map.set(`:${model}`, price);
    }
    priceCache = map;
    cacheExpireAt = now + CACHE_TTL_MS;
    return map;
  }
}

/** 手动清除价格缓存（管理后台修改价格后调用） */
export function invalidatePriceCache(): void {
  priceCache = null;
  cacheExpireAt = 0;
}

// ========== 渠道缓存（30秒 TTL） ==========

export interface ChannelInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
}

let channelCache: ChannelInfo[] | null = null;
let channelCacheExpireAt = 0;
const CHANNEL_CACHE_TTL_MS = 30_000;

export async function loadActiveChannels(): Promise<ChannelInfo[]> {
  const now = Date.now();
  if (channelCache && now < channelCacheExpireAt) return channelCache;

  const { db } = await getDb();
  const result = await db.select().from(channels).where(eq(channels.status, "active")).orderBy(channels.priority);
  channelCache = result.map((ch) => ({
    id: ch.id,
    name: ch.name,
    baseUrl: ch.baseUrl,
    apiKey: ensureDecrypted(ch.apiKey),
    models: (typeof ch.models === "string" ? JSON.parse(ch.models) : ch.models) as string[],
    priority: ch.priority,
  }));
  channelCacheExpireAt = now + CHANNEL_CACHE_TTL_MS;
  return channelCache;
}

/** 清除渠道缓存（管理后台修改渠道后调用） */
export function invalidateChannelCache(): void {
  channelCache = null;
  channelCacheExpireAt = 0;
}

// ========== 限额规则缓存（30秒 TTL） ==========

type QuotaRule = InferSelectModel<typeof quotaRules>;
let quotaCache: { rules: QuotaRule[] } | null = null;
let quotaCacheExpireAt = 0;
const QUOTA_CACHE_TTL_MS = 30_000;

export async function loadQuotaRules(): Promise<QuotaRule[]> {
  const now = Date.now();
  if (quotaCache && now < quotaCacheExpireAt) return quotaCache.rules;

  const { db } = await getDb();
  const rules = await db.select().from(quotaRules);
  quotaCache = { rules };
  quotaCacheExpireAt = now + QUOTA_CACHE_TTL_MS;
  return rules;
}

/** 清除限额缓存（管理后台修改额度后调用） */
export function invalidateQuotaCache(): void {
  quotaCache = null;
  quotaCacheExpireAt = 0;
}

// ========== 费用计算 ==========

/**
 * 计算单次请求费用
 * 三级查找链：(channelId, model) → (NULL, model) → 硬编码兜底
 */
export async function calculateCost(channelId: string, model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): Promise<number> {
  const prices = await loadPriceTable();

  // 第一级：渠道专属价格
  let price = prices.get(`${channelId}:${model}`);

  if (!price) {
    // 第二级：全局价格
    price = prices.get(`:${model}`);
  }

  if (!price) {
    // 第三级：硬编码兜底
    price = prices.get(`:deepseek-chat`) || FALLBACK_PRICES["deepseek-chat"];
  }

  const nonCached = Math.max(0, inputTokens - cachedTokens);
  return (nonCached * price.input + cachedTokens * price.cache + outputTokens * price.output) / 1_000_000;
}
