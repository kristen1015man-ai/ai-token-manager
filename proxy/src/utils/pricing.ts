/**
 * 模型计价模块（从数据库读取，进程内缓存 60 秒）
 *
 * 价格来源：model_prices 表，支持「渠道+模型」组合定价
 * 查找链：(channelId, model) → (NULL, model) → 硬编码兜底
 * 缓存策略：60 秒 TTL，管理后台修改时立即失效
 */

import { getDb } from "../../../shared/db.js";
import { modelPrices } from "../../../shared/schema.js";
import { getUsdCnyRate } from "./exchange-rate.js";

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion: number;
  currency: "CNY" | "USD";  // 价格原始币种，USD 时需要乘以汇率转 CNY
}

// ===== Fallback 价格（数据库无数据时兜底） =====
const FALLBACK_PRICES: Record<string, ModelPrice> = {
  "deepseek-chat": { inputPerMillion: 1.0, outputPerMillion: 2.0, cachePerMillion: 0.1, currency: "CNY" },
  "deepseek-reasoner": { inputPerMillion: 4.0, outputPerMillion: 16.0, cachePerMillion: 0.4, currency: "CNY" },
};

// ===== 进程内缓存 =====
// key 格式："channelId:model" 或 ":model"（全局价格）
let priceCache: Map<string, ModelPrice> | null = null;
let cacheExpireAt = 0;
const CACHE_TTL_MS = 60_000; // 60 秒

/**
 * 从数据库加载价格表（带缓存）
 * 缓存 key 为复合键 "channelId:model"，全局价格为 ":model"
 */
async function loadPriceTable(): Promise<Map<string, ModelPrice>> {
  const now = Date.now();
  if (priceCache && now < cacheExpireAt) return priceCache;

  try {
    const { db } = await getDb();
    const rows = await db.select().from(modelPrices);
    const map = new Map<string, ModelPrice>();
    for (const row of rows) {
      // 复合键：channelId 为 null 时用空字符串前缀
      const key = `${row.channelId ?? ""}:${row.model}`;
      map.set(key, {
        inputPerMillion: row.inputPerMillion,
        outputPerMillion: row.outputPerMillion,
        cachePerMillion: row.cachePerMillion,
        currency: row.currency === "USD" ? "USD" : "CNY",
      });
    }
    priceCache = map;
    cacheExpireAt = now + CACHE_TTL_MS;
    return map;
  } catch (err) {
    console.error("[Pricing] 加载价格表失败，使用 fallback:", err);
    // DB 不可用时用 fallback（以全局价格格式存储）
    const map = new Map<string, ModelPrice>();
    for (const [model, price] of Object.entries(FALLBACK_PRICES)) {
      map.set(`:${model}`, price);
    }
    priceCache = map;
    cacheExpireAt = now + CACHE_TTL_MS;
    return map;
  }
}

/**
 * 手动清除缓存（管理后台修改价格后调用）
 */
export function invalidatePriceCache(): void {
  priceCache = null;
  cacheExpireAt = 0;
}

/**
 * 计算单次请求费用（统一返回 CNY）
 * 三级查找链：(channelId, model) → (NULL, model) → 硬编码兜底
 * 公式：(非缓存输入 × 输入价 + 缓存Token × 缓存价 + 输出Token × 输出价) / 1,000,000
 * 如果价格为 USD，自动乘以实时汇率转换为 CNY
 */
export async function calculateCost(
  channelId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0
): Promise<number> {
  const prices = await loadPriceTable();

  // 第一级：渠道专属价格
  const channelKey = `${channelId}:${model}`;
  let price = prices.get(channelKey);

  if (!price) {
    // 第二级：全局价格（channel_id = NULL）
    const globalKey = `:${model}`;
    price = prices.get(globalKey);
  }

  if (!price) {
    // 第三级：硬编码兜底
    const fallbackKey = `:deepseek-chat`;
    const fallback = prices.get(fallbackKey) || FALLBACK_PRICES["deepseek-chat"];
    const nonCached = Math.max(0, inputTokens - cachedTokens);
    const cost = (
      nonCached * fallback.inputPerMillion +
      cachedTokens * fallback.cachePerMillion +
      outputTokens * fallback.outputPerMillion
    ) / 1_000_000;
    return convertToCNY(cost, fallback.currency);
  }

  const nonCached = Math.max(0, inputTokens - cachedTokens);
  const cost = (
    nonCached * price.inputPerMillion +
    cachedTokens * price.cachePerMillion +
    outputTokens * price.outputPerMillion
  ) / 1_000_000;
  return convertToCNY(cost, price.currency);
}

/**
 * 将费用统一转换为 CNY
 * USD 价格需要乘以实时汇率
 */
async function convertToCNY(cost: number, currency: "CNY" | "USD"): Promise<number> {
  if (currency === "USD") {
    try {
      const { rate } = await getUsdCnyRate();
      return cost * rate;
    } catch (err) {
      console.warn("[Pricing] USD/CNY 汇率获取失败，使用硬编码 7.2:", err instanceof Error ? err.message : err);
      return cost * 7.2; // 汇率获取失败时用硬编码
    }
  }
  return cost;
}

/**
 * 获取所有已知模型列表（去重）
 */
export async function getKnownModels(): Promise<string[]> {
  const prices = await loadPriceTable();
  const models = new Set<string>();
  for (const key of prices.keys()) {
    const model = key.split(":").slice(1).join(":"); // 处理 model 名可能含冒号的情况
    models.add(model);
  }
  return Array.from(models);
}
