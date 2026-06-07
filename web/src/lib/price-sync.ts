/**
 * 多供应商模型价格自动同步模块
 *
 * 同步策略：
 * - 价格绑定到具体渠道（通过 channel.provider 匹配）
 * - USD 渠道存 USD 原价 + currency: "USD"，CNY 渠道存 CNY 价格
 * - syncedAt 不为 null 的行 → 允许被官网同步覆盖
 * - syncedAt 为 null 的行 → 手动编辑过，不覆盖
 * - 无匹配渠道时写全局价格（向后兼容）
 *
 * 汇率通过 exchange-rate 模块动态获取
 */

import { randomBytes } from "crypto";
import { getDb, saveDb, type SqliteExec } from "./db";
import { modelPrices, channels } from "../../../shared/schema";
import { eq } from "drizzle-orm";
import { getUsdCnyRate } from "./exchange-rate";
import { r2, type ParsedPrice } from "./price-scrapers/helpers";
import {
  fetchDeepSeekPrices,
  fetchGLMPrices,
  fetchOpenAIPrices,
  fetchAnthropicPrices,
  fetchSiliconFlowPrices,
} from "./price-scrapers/scrapers";

// 重导出 ParsedPrice 供外部使用
export type { ParsedPrice };

/**
 * 从所有供应商抓取最新价格
 */
export async function fetchOfficialPrices(): Promise<ParsedPrice[]> {
  const { rate } = await getUsdCnyRate();

  const allPrices = await Promise.all([
    fetchDeepSeekPrices(rate),
    fetchGLMPrices(rate),
    fetchOpenAIPrices(rate),
    fetchAnthropicPrices(rate),
    fetchSiliconFlowPrices(rate),
  ]);

  return allPrices.flat();
}

/**
 * 执行价格同步：对比官网价格与数据库，按渠道更新
 *
 * 规则：
 * - 从 DB 加载 channels，建立 provider → channelId[] 映射
 * - 匹配到渠道的价格写入该渠道（USD 渠道存 USD 原价，CNY 渠道存 CNY 价格）
 * - 无匹配渠道的价格写入全局（channel_id = NULL, currency = "CNY"）
 * - syncedAt 不为 null → 允许被官网同步覆盖
 * - syncedAt 为 null → 手动编辑过，不覆盖
 * - 黑名单检查使用 (model, channelId) 复合键
 *
 * @returns 更新/新增/跳过计数 + 供应商列表 + 汇率信息
 */
export async function syncPricesFromOfficial(): Promise<{
  updated: number;
  added: number;
  skipped: number;
  providers: string[];
  exchangeRate: { rate: number; source: string };
}> {
  const { rate, source } = await getUsdCnyRate();
  const officialPrices = await fetchOfficialPrices();

  if (officialPrices.length === 0) {
    throw new Error("所有供应商价格解析结果为空，可能网络问题或页面结构变化");
  }

  // 统计成功的供应商
  const providers = [...new Set(officialPrices.map((p) => p.provider))];

  const { db, sqlite } = await getDb();
  const dbAny = sqlite as unknown as SqliteExec;

  // 加载所有渠道，建立 provider → channel[] 映射
  const channelList = await db.select({
    id: channels.id,
    name: channels.name,
    provider: channels.provider,
    currency: channels.currency,
  }).from(channels);

  const providerToChannels = new Map<string, typeof channelList>();
  for (const ch of channelList) {
    if (!ch.provider) continue;
    const arr = providerToChannels.get(ch.provider) || [];
    arr.push(ch);
    providerToChannels.set(ch.provider, arr);
  }

  // 加载所有价格（全局 + 渠道级）
  const existing = await db.select().from(modelPrices);
  const priceMap = new Map<string, typeof existing[0]>();
  for (const row of existing) {
    const key = row.channelId ? `${row.channelId}:${row.model}` : `:${row.model}`;
    priceMap.set(key, row);
  }

  // 加载同步黑名单（复合主键）
  const blacklist = new Set<string>();
  try {
    const blRows = dbAny.exec("SELECT model, channel_id FROM sync_blacklist");
    for (const r of (blRows[0]?.values ?? [])) {
      const channelId = r[1] ? String(r[1]) : "";
      blacklist.add(`${channelId}:${String(r[0])}`);
    }
  } catch { /* sync_blacklist 表可能还不存在 */ }

  let updated = 0;
  let added = 0;
  let skipped = 0;
  const now = new Date();

  for (const price of officialPrices) {
    const matchedChannels = providerToChannels.get(price.provider) || [];

    if (matchedChannels.length > 0) {
      // 有匹配渠道 → 逐渠道写入
      for (const ch of matchedChannels) {
        const blKey = `${ch.id}:${price.model}`;
        const priceKey = `${ch.id}:${price.model}`;

        if (blacklist.has(blKey) || blacklist.has(`:${price.model}`)) {
          console.log(`[PriceSync] 模型 '${price.model}' 渠道 '${ch.name}' 在同步黑名单中，跳过`);
          skipped++;
          continue;
        }

        const isUSDChannel = ch.currency === "USD";
        const writeCurrency = isUSDChannel ? "USD" : "CNY";
        const writeInput = isUSDChannel ? price.rawInputPerMillion : (price.currency === "USD" ? r2(price.rawInputPerMillion * rate) : price.rawInputPerMillion);
        const writeOutput = isUSDChannel ? price.rawOutputPerMillion : (price.currency === "USD" ? r2(price.rawOutputPerMillion * rate) : price.rawOutputPerMillion);
        const writeCache = isUSDChannel ? price.rawCachePerMillion : (price.currency === "USD" ? r2(price.rawCachePerMillion * rate) : price.rawCachePerMillion);

        const row = priceMap.get(priceKey);

        if (row) {
          if (row.syncedAt !== null) {
            await db.update(modelPrices).set({
              inputPerMillion: writeInput,
              outputPerMillion: writeOutput,
              cachePerMillion: writeCache,
              displayName: price.displayName,
              currency: writeCurrency,
              syncedAt: now,
              updatedBy: "auto-sync",
              updatedAt: now,
            }).where(eq(modelPrices.id, row.id));
            updated++;
          }
        } else {
          await db.insert(modelPrices).values({
            id: `price_${randomBytes(6).toString("hex")}`,
            model: price.model,
            channelId: ch.id,
            inputPerMillion: writeInput,
            outputPerMillion: writeOutput,
            cachePerMillion: writeCache,
            displayName: price.displayName,
            currency: writeCurrency,
            deprecated: false,
            syncedAt: now,
            updatedBy: "auto-sync",
            updatedAt: now,
            createdAt: now,
          });
          added++;
        }
      }
    } else {
      // 无匹配渠道 → 写全局价格
      const blKey = `:${price.model}`;
      const priceKey = `:${price.model}`;

      if (blacklist.has(blKey)) {
        console.log(`[PriceSync] 全局模型 '${price.model}' 在同步黑名单中，跳过`);
        skipped++;
        continue;
      }

      const writeInput = price.currency === "USD" ? r2(price.rawInputPerMillion * rate) : price.rawInputPerMillion;
      const writeOutput = price.currency === "USD" ? r2(price.rawOutputPerMillion * rate) : price.rawOutputPerMillion;
      const writeCache = price.currency === "USD" ? r2(price.rawCachePerMillion * rate) : price.rawCachePerMillion;

      const row = priceMap.get(priceKey);

      if (row) {
        if (row.syncedAt !== null) {
          await db.update(modelPrices).set({
            inputPerMillion: writeInput,
            outputPerMillion: writeOutput,
            cachePerMillion: writeCache,
            displayName: price.displayName,
            currency: "CNY",
            syncedAt: now,
            updatedBy: "auto-sync",
            updatedAt: now,
          }).where(eq(modelPrices.id, row.id));
          updated++;
        }
      } else {
        await db.insert(modelPrices).values({
          id: `price_${randomBytes(6).toString("hex")}`,
          model: price.model,
          channelId: null,
          inputPerMillion: writeInput,
          outputPerMillion: writeOutput,
          cachePerMillion: writeCache,
          displayName: price.displayName,
          currency: "CNY",
          deprecated: false,
          syncedAt: now,
          updatedBy: "auto-sync",
          updatedAt: now,
          createdAt: now,
        });
        added++;
      }
    }
  }

  await saveDb();

  // 清除代理进程的价格缓存
  try {
    const { invalidatePriceCache } = await import("./proxy");
    invalidatePriceCache();
  } catch { /* 非 proxy 进程时忽略 */ }

  return { updated, added, skipped, providers, exchangeRate: { rate, source } };
}
