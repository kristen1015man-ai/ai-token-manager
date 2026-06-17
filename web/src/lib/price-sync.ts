import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { channels, modelPrices } from "../../../shared/schema";
import { getDb, saveDb, type SqliteExec } from "./db";
import { getUsdCnyRate } from "./exchange-rate";
import { inferAutoProvider } from "./balance-fetchers";
import { r2, type ParsedPrice } from "./price-scrapers/helpers";
import {
  fetchAnthropicPrices,
  fetchDeepSeekPrices,
  fetchGLMPrices,
  fetchOpenAIPrices,
  fetchSiliconFlowPrices,
} from "./price-scrapers/scrapers";

export type { ParsedPrice };

export interface ProviderSourceSummary {
  official: number;
  fallback: number;
  total: number;
  channelCount: number;
}

export interface PriceSyncResult {
  updated: number;
  added: number;
  skipped: number;
  skippedManual: number;
  skippedBlacklist: number;
  providers: string[];
  warnings: string[];
  sourceSummary: Record<string, ProviderSourceSummary>;
  exchangeRate: { rate: number; source: string };
}

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

export async function syncPricesFromOfficial(): Promise<PriceSyncResult> {
  const { rate, source } = await getUsdCnyRate();
  const officialPrices = await fetchOfficialPrices();
  if (officialPrices.length === 0) {
    throw new Error("所有供应商价格解析结果为空，可能是网络问题或官方页面结构已变化");
  }

  const providers = [...new Set(officialPrices.map((price) => price.provider))].sort();
  const { db, sqlite } = await getDb();
  const dbAny = sqlite as unknown as SqliteExec;

  const channelList = await db.select({
    id: channels.id,
    name: channels.name,
    baseUrl: channels.baseUrl,
    provider: channels.provider,
    currency: channels.currency,
  }).from(channels);

  const sourceSummary = buildSourceSummary(officialPrices);
  const providerToChannels = new Map<string, typeof channelList>();
  for (const ch of channelList) {
    const inferredProvider = inferPriceProvider(ch);
    if (!inferredProvider) continue;
    if (inferredProvider !== ch.provider) {
      await db.update(channels).set({ provider: inferredProvider }).where(eq(channels.id, ch.id));
      ch.provider = inferredProvider;
    }
    const arr = providerToChannels.get(inferredProvider) || [];
    arr.push(ch);
    providerToChannels.set(inferredProvider, arr);
  }

  for (const [provider, matchedChannels] of providerToChannels.entries()) {
    if (!sourceSummary[provider]) {
      sourceSummary[provider] = { official: 0, fallback: 0, total: 0, channelCount: matchedChannels.length };
    } else {
      sourceSummary[provider].channelCount = matchedChannels.length;
    }
  }

  const existing = await db.select().from(modelPrices);
  const priceMap = new Map<string, typeof existing[0]>();
  for (const row of existing) {
    priceMap.set(priceKey(row.channelId, row.model), row);
  }

  const blacklist = loadSyncBlacklist(dbAny);
  let updated = 0;
  let added = 0;
  let skippedManual = 0;
  let skippedBlacklist = 0;
  const now = new Date();

  for (const price of officialPrices) {
    const matchedChannels = providerToChannels.get(price.provider) || [];
    if (matchedChannels.length > 0) {
      for (const ch of matchedChannels) {
        const result = await writePrice({
          price,
          channelId: ch.id,
          channelName: ch.name,
          channelCurrency: ch.currency,
          rate,
          now,
          priceMap,
          blacklist,
        });
        updated += result.updated;
        added += result.added;
        skippedManual += result.skippedManual;
        skippedBlacklist += result.skippedBlacklist;
      }
    } else {
      const result = await writePrice({
        price,
        channelId: null,
        channelName: "global",
        channelCurrency: "CNY",
        rate,
        now,
        priceMap,
        blacklist,
      });
      updated += result.updated;
      added += result.added;
      skippedManual += result.skippedManual;
      skippedBlacklist += result.skippedBlacklist;
    }
  }

  await saveDb();
  try {
    const { invalidatePriceCache } = await import("./proxy/cache");
    invalidatePriceCache();
  } catch {
    // The web process can run without the proxy cache module during isolated checks.
  }

  return {
    updated,
    added,
    skipped: skippedManual + skippedBlacklist,
    skippedManual,
    skippedBlacklist,
    providers,
    warnings: buildWarnings(sourceSummary),
    sourceSummary,
    exchangeRate: { rate, source },
  };

  async function writePrice(args: {
    price: ParsedPrice;
    channelId: string | null;
    channelName: string;
    channelCurrency: string;
    rate: number;
    now: Date;
    priceMap: Map<string, typeof existing[0]>;
    blacklist: Set<string>;
  }): Promise<{ updated: number; added: number; skippedManual: number; skippedBlacklist: number }> {
    const { price, channelId, channelName, channelCurrency, rate, now, priceMap, blacklist } = args;
    const key = priceKey(channelId, price.model);
    if (blacklist.has(key) || blacklist.has(priceKey(null, price.model))) {
      console.log(`[PriceSync] skip blacklisted model=${price.model} channel=${channelName}`);
      return { updated: 0, added: 0, skippedManual: 0, skippedBlacklist: 1 };
    }

    const isUSDChannel = channelCurrency === "USD";
    const writeCurrency = isUSDChannel ? "USD" : "CNY";
    const writeInput = isUSDChannel
      ? price.rawInputPerMillion
      : price.currency === "USD" ? r2(price.rawInputPerMillion * rate) : price.rawInputPerMillion;
    const writeOutput = isUSDChannel
      ? price.rawOutputPerMillion
      : price.currency === "USD" ? r2(price.rawOutputPerMillion * rate) : price.rawOutputPerMillion;
    const writeCache = isUSDChannel
      ? price.rawCachePerMillion
      : price.currency === "USD" ? r2(price.rawCachePerMillion * rate) : price.rawCachePerMillion;

    const row = priceMap.get(key);
    if (row) {
      if (row.syncedAt === null) {
        return { updated: 0, added: 0, skippedManual: 1, skippedBlacklist: 0 };
      }
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
      return { updated: 1, added: 0, skippedManual: 0, skippedBlacklist: 0 };
    }

    const inserted = {
      id: `price_${randomBytes(6).toString("hex")}`,
      model: price.model,
      channelId,
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
    };
    await db.insert(modelPrices).values(inserted);
    priceMap.set(key, inserted);
    return { updated: 0, added: 1, skippedManual: 0, skippedBlacklist: 0 };
  }
}

function priceKey(channelId: string | null, model: string): string {
  return `${channelId || ""}:${model}`;
}

function loadSyncBlacklist(dbAny: SqliteExec): Set<string> {
  const blacklist = new Set<string>();
  try {
    const rows = dbAny.exec("SELECT model, channel_id FROM sync_blacklist");
    for (const row of rows[0]?.values ?? []) {
      blacklist.add(priceKey(row[1] ? String(row[1]) : null, String(row[0])));
    }
  } catch {
    // Older databases may not have sync_blacklist yet.
  }
  return blacklist;
}

function inferPriceProvider(ch: { id: string; name: string; baseUrl: string; provider: string | null }): string | null {
  const explicit = ch.provider?.trim().toLowerCase() || "";
  if (explicit) return explicit;

  const auto = inferAutoProvider(null, ch.baseUrl, ch.name, ch.id);
  if (auto) return auto;

  const text = `${ch.id} ${ch.name} ${ch.baseUrl}`.toLowerCase();
  if (text.includes("openai")) return "openai";
  if (text.includes("anthropic") || text.includes("claude")) return "anthropic";
  if (text.includes("bigmodel") || text.includes("zhipu") || text.includes("glm")) return "glm";
  return null;
}

function buildSourceSummary(prices: ParsedPrice[]): Record<string, ProviderSourceSummary> {
  const summary: Record<string, ProviderSourceSummary> = {};
  for (const price of prices) {
    const item = summary[price.provider] || { official: 0, fallback: 0, total: 0, channelCount: 0 };
    const source = price.source || "fallback";
    item[source] += 1;
    item.total += 1;
    summary[price.provider] = item;
  }
  return summary;
}

function buildWarnings(summary: Record<string, ProviderSourceSummary>): string[] {
  return Object.entries(summary)
    .filter(([, item]) => item.fallback > 0)
    .map(([provider, item]) => `${provider} 官方价格抓取失败或解析为空，已使用内置兜底价 ${item.fallback} 条`);
}
