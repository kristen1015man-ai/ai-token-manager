/**
 * 多供应商模型价格自动同步模块
 *
 * 支持从以下供应商官网抓取最新价格：
 * - DeepSeek（https://api-docs.deepseek.com/zh-cn/quick_start/pricing）
 * - 智谱 GLM（https://open.bigmodel.cn/pricing）
 * - OpenAI（https://openai.com/api/pricing/）
 * - Anthropic（https://platform.claude.com/docs/en/about-claude/pricing）
 * - 硅基流动 SiliconFlow（https://siliconflow.cn/pricing）
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

import { getDb, saveDb } from "./db";
import { modelPrices, channels, syncBlacklist } from "../../../shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getUsdCnyRate } from "./exchange-rate";

/** 解析后的价格条目 */
interface ParsedPrice {
  model: string;
  inputPerMillion: number;   // 已转换为 CNY（或保持原币种）
  outputPerMillion: number;
  cachePerMillion: number;
  displayName: string;
  provider: string;
  currency: "CNY" | "USD";    // 原始币种
  rawInputPerMillion: number;  // 原始币种价格（未转换）
  rawOutputPerMillion: number;
  rawCachePerMillion: number;
}

/** 通用 fetch 封装 */
async function fetchPage(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`请求失败: HTTP ${resp.status} (${url})`);
  return resp.text();
}

/** 辅助：四舍五入到 2 位小数 */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================
// DeepSeek 价格抓取（CNY）
// ============================================================
async function fetchDeepSeekPrices(rate: number): Promise<ParsedPrice[]> {
  try {
    const url = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
    const html = await fetchPage(url);

    const prices = parseHtmlTablePrices(html, "deepseek", {
      "deepseek-v4-flash": { displayName: "DeepSeek V4 Flash", keywords: ["v4", "flash"] },
      "deepseek-v4-pro": { displayName: "DeepSeek V4 Pro", keywords: ["v4", "pro"] },
      "deepseek-chat": { displayName: "DeepSeek Chat", keywords: ["chat"] },
      "deepseek-reasoner": { displayName: "DeepSeek Reasoner", keywords: ["reasoner"] },
    });

    if (prices.length > 0) return prices;

    console.warn("[PriceSync] DeepSeek HTML 解析为空，使用兜底价格");
    return [
      makeCNY("deepseek-v4-flash", "DeepSeek V4 Flash", 1, 2, 0.02),
      makeCNY("deepseek-v4-pro", "DeepSeek V4 Pro", 3, 6, 0.025),
    ];
  } catch (err) {
    console.error("[PriceSync] DeepSeek 抓取失败:", err);
    return [
      makeCNY("deepseek-v4-flash", "DeepSeek V4 Flash", 1, 2, 0.02),
      makeCNY("deepseek-v4-pro", "DeepSeek V4 Pro", 3, 6, 0.025),
    ];
  }
}

// ============================================================
// 智谱 GLM 价格抓取（CNY）
// ============================================================
async function fetchGLMPrices(rate: number): Promise<ParsedPrice[]> {
  try {
    const url = "https://open.bigmodel.cn/pricing";
    const html = await fetchPage(url);

    const prices = parseHtmlTablePrices(html, "glm", {
      "glm-5.1": { displayName: "GLM-5.1", keywords: ["glm-5", "5.1"] },
      "glm-4-plus": { displayName: "GLM-4 Plus", keywords: ["4-plus", "4plus"] },
      "glm-4-flash": { displayName: "GLM-4 Flash", keywords: ["4-flash", "4flash"] },
    });

    if (prices.length > 0) return prices;

    console.warn("[PriceSync] GLM HTML 解析为空，使用兜底价格");
    return [
      makeCNY("glm-5.1", "GLM-5.1", 6, 24, 0.5),
      makeCNY("glm-4-plus", "GLM-4 Plus", 50, 50, 0),
      makeCNY("glm-4-flash", "GLM-4 Flash", 0.1, 0.1, 0),
    ].map(p => { p.provider = "glm"; return p; });
  } catch (err) {
    console.error("[PriceSync] GLM 抓取失败:", err);
    return [
      makeCNY("glm-5.1", "GLM-5.1", 6, 24, 0.5),
      makeCNY("glm-4-plus", "GLM-4 Plus", 50, 50, 0),
      makeCNY("glm-4-flash", "GLM-4 Flash", 0.1, 0.1, 0),
    ].map(p => { p.provider = "glm"; return p; });
  }
}

// ============================================================
// OpenAI 价格抓取（USD）
// ============================================================
async function fetchOpenAIPrices(rate: number): Promise<ParsedPrice[]> {
  const USD_FALLBACKS: [string, string, number, number, number][] = [
    ["gpt-5.5", "GPT-5.5", 5, 30, 0.5],
    ["gpt-4o", "GPT-4o", 2.5, 10, 0.25],
    ["gpt-4o-mini", "GPT-4o Mini", 0.15, 0.6, 0.015],
  ];

  try {
    const url = "https://openai.com/api/pricing/";
    const html = await fetchPage(url);
    const text = html.replace(/<[^>]+>/g, " ").toLowerCase();

    const prices: ParsedPrice[] = [];

    const extractUSD = (context: string): number[] => {
      return (context.match(/\$?([\d.]+)\s*\/\s*1m/gi) || []).map((s) => {
        const n = s.match(/([\d.]+)/);
        return n ? parseFloat(n[1]) : 0;
      }).filter((n) => n > 0);
    };

    const tryExtract = (model: string, displayName: string, searchTerms: string[]): void => {
      for (const term of searchTerms) {
        const idx = text.indexOf(term);
        if (idx === -1) continue;
        const context = text.slice(Math.max(0, idx - 100), idx + 300);
        const nums = extractUSD(context);
        if (nums.length >= 2) {
          prices.push(makeUSD(model, displayName, nums[0], nums[1], nums.length >= 3 ? nums[2] : nums[0] * 0.1, rate));
          return;
        }
      }
    };

    tryExtract("gpt-5.5", "GPT-5.5", ["gpt-5.5", "gpt 5.5"]);
    tryExtract("gpt-4o", "GPT-4o", ["gpt-4o", "gpt 4o"]);
    tryExtract("gpt-4o-mini", "GPT-4o Mini", ["gpt-4o-mini", "gpt-4o mini", "gpt4omini"]);

    if (prices.length > 0) return prices;

    console.warn("[PriceSync] OpenAI HTML 解析为空，使用兜底价格");
    return USD_FALLBACKS.map(([model, name, inp, out, cache]) => makeUSD(model, name, inp, out, cache, rate));
  } catch (err) {
    console.error("[PriceSync] OpenAI 抓取失败:", err);
    return USD_FALLBACKS.map(([model, name, inp, out, cache]) => makeUSD(model, name, inp, out, cache, rate));
  }
}

// ============================================================
// Anthropic 价格抓取（USD）
// ============================================================
async function fetchAnthropicPrices(rate: number): Promise<ParsedPrice[]> {
  const USD_FALLBACKS: [string, string, number, number, number][] = [
    ["claude-opus-4-8", "Claude Opus 4.8", 5, 25, 0.5],
    ["claude-sonnet-4-6", "Claude Sonnet 4.6", 3, 15, 0.3],
    ["claude-haiku-4-5", "Claude Haiku 4.5", 1, 5, 0.1],
  ];

  try {
    const url = "https://platform.claude.com/docs/en/about-claude/pricing";
    const html = await fetchPage(url);
    const text = html.replace(/<[^>]+>/g, " ").toLowerCase();

    const prices: ParsedPrice[] = [];

    const extractUSD = (context: string): number[] => {
      return (context.match(/\$?([\d.]+)\s*(?:\/\s*)?(?:per\s*)?(?:1m|m\b)/gi) || []).map((s) => {
        const n = s.match(/([\d.]+)/);
        return n ? parseFloat(n[1]) : 0;
      }).filter((n) => n > 0);
    };

    const tryExtract = (model: string, displayName: string, searchTerms: string[]): void => {
      for (const term of searchTerms) {
        const idx = text.indexOf(term);
        if (idx === -1) continue;
        const context = text.slice(Math.max(0, idx - 100), idx + 300);
        const nums = extractUSD(context);
        if (nums.length >= 2) {
          const p = makeUSD(model, displayName, nums[0], nums[1], nums.length >= 3 ? nums[2] : nums[0] * 0.1, rate);
          p.provider = "anthropic";
          prices.push(p);
          return;
        }
      }
    };

    tryExtract("claude-opus-4-8", "Claude Opus 4.8", ["opus 4.8", "opus-4-8", "opus4.8"]);
    tryExtract("claude-sonnet-4-6", "Claude Sonnet 4.6", ["sonnet 4.6", "sonnet-4-6", "sonnet4.6"]);
    tryExtract("claude-haiku-4-5", "Claude Haiku 4.5", ["haiku 4.5", "haiku-4-5"]);

    if (prices.length > 0) return prices;

    console.warn("[PriceSync] Anthropic HTML 解析为空，使用兜底价格");
    return USD_FALLBACKS.map(([model, name, inp, out, cache]) => {
      const p = makeUSD(model, name, inp, out, cache, rate);
      p.provider = "anthropic";
      return p;
    });
  } catch (err) {
    console.error("[PriceSync] Anthropic 抓取失败:", err);
    return USD_FALLBACKS.map(([model, name, inp, out, cache]) => {
      const p = makeUSD(model, name, inp, out, cache, rate);
      p.provider = "anthropic";
      return p;
    });
  }
}

// ============================================================
// 硅基流动 SiliconFlow 价格抓取（CNY）
// ============================================================
async function fetchSiliconFlowPrices(rate: number): Promise<ParsedPrice[]> {
  try {
    const url = "https://siliconflow.cn/pricing";
    const html = await fetchPage(url);

    const prices = parseHtmlTablePrices(html, "siliconflow", {
      "deepseek-v4-flash": { displayName: "DeepSeek V4 Flash (硅基)", keywords: ["deepseek", "v4", "flash"] },
      "deepseek-v4-pro": { displayName: "DeepSeek V4 Pro (硅基)", keywords: ["deepseek", "v4", "pro"] },
      "deepseek-reasoner": { displayName: "DeepSeek Reasoner (硅基)", keywords: ["deepseek", "reasoner"] },
      "qwen3-235b-a22b": { displayName: "Qwen3 235B (硅基)", keywords: ["qwen3", "235"] },
    });

    if (prices.length > 0) return prices;

    console.warn("[PriceSync] SiliconFlow HTML 解析为空，使用兜底价格");
    return [
      makeCNY("deepseek-v4-flash", "DeepSeek V4 Flash (硅基)", 1.5, 3, 0.03),
      makeCNY("deepseek-v4-pro", "DeepSeek V4 Pro (硅基)", 4, 8, 0.04),
      makeCNY("deepseek-reasoner", "DeepSeek Reasoner (硅基)", 6, 24, 0.6),
      makeCNY("qwen3-235b-a22b", "Qwen3 235B (硅基)", 2, 8, 0.2),
    ].map(p => { p.provider = "siliconflow"; return p; });
  } catch (err) {
    console.error("[PriceSync] SiliconFlow 抓取失败:", err);
    return [
      makeCNY("deepseek-v4-flash", "DeepSeek V4 Flash (硅基)", 1.5, 3, 0.03),
      makeCNY("deepseek-v4-pro", "DeepSeek V4 Pro (硅基)", 4, 8, 0.04),
      makeCNY("deepseek-reasoner", "DeepSeek Reasoner (硅基)", 6, 24, 0.6),
      makeCNY("qwen3-235b-a22b", "Qwen3 235B (硅基)", 2, 8, 0.2),
    ].map(p => { p.provider = "siliconflow"; return p; });
  }
}

// ============================================================
// 辅助函数
// ============================================================

/** 创建 CNY 价格（raw 值 = 主值） */
function makeCNY(model: string, displayName: string, input: number, output: number, cache: number): ParsedPrice {
  return {
    model,
    inputPerMillion: input,
    outputPerMillion: output,
    cachePerMillion: cache,
    displayName,
    provider: "deepseek",  // 默认，parseHtmlTablePrices 会覆盖
    currency: "CNY",
    rawInputPerMillion: input,
    rawOutputPerMillion: output,
    rawCachePerMillion: cache,
  };
}

/** 创建 USD 价格（主值 = raw × rate） */
function makeUSD(model: string, displayName: string, input: number, output: number, cache: number, rate: number): ParsedPrice {
  return {
    model,
    inputPerMillion: r2(input * rate),
    outputPerMillion: r2(output * rate),
    cachePerMillion: r2(cache * rate),
    displayName,
    provider: "openai",  // 默认，调用方会覆盖
    currency: "USD",
    rawInputPerMillion: input,
    rawOutputPerMillion: output,
    rawCachePerMillion: cache,
  };
}

// ============================================================
// 通用 HTML 表格解析
// ============================================================
interface ModelPattern {
  displayName: string;
  keywords: string[];
}

function parseHtmlTablePrices(
  html: string,
  providerPrefix: string,
  modelPatterns: Record<string, ModelPattern>
): ParsedPrice[] {
  const prices: ParsedPrice[] = [];

  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  let tableMatch;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableContent = tableMatch[1];
    let rowMatch;
    let headerMode = true;

    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const cells: string[] = [];
      let cellMatch;
      const rowContent = rowMatch[1];

      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const text = cellMatch[1].replace(/<[^>]+>/g, "").trim();
        cells.push(text);
      }

      if (headerMode) { headerMode = false; continue; }
      if (cells.length < 3) continue;

      // 提取数字
      const numbers = cells.slice(1).map((c) => {
        const match = c.match(/([\d.]+)/);
        return match ? parseFloat(match[1]) : NaN;
      }).filter((n) => !isNaN(n));

      if (numbers.length < 2) continue;

      const modelStr = cells[0].toLowerCase().trim();

      // 匹配已知模型
      for (const [modelId, pattern] of Object.entries(modelPatterns)) {
        const allMatch = pattern.keywords.every((kw) => modelStr.includes(kw));
        if (allMatch) {
          const inp = numbers[0];
          const out = numbers[1];
          const cache = numbers.length >= 3 ? numbers[2] : inp * 0.1;
          // HTML 表格解析的价格直接用，provider 前缀决定币种
          const isUSD = ["openai", "anthropic"].includes(providerPrefix);
          prices.push({
            model: modelId,
            inputPerMillion: inp,
            outputPerMillion: out,
            cachePerMillion: cache,
            displayName: pattern.displayName,
            provider: providerPrefix,
            currency: isUSD ? "USD" : "CNY",
            rawInputPerMillion: inp,
            rawOutputPerMillion: out,
            rawCachePerMillion: cache,
          });
          break;
        }
      }
    }
  }

  return prices;
}

// ============================================================
// 同步入口
// ============================================================

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
  const dbAny = sqlite as any;

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
  const priceMap = new Map<string, typeof existing[0]>();  // key = "model" or "channelId:model"
  for (const row of existing) {
    const key = row.channelId ? `${row.channelId}:${row.model}` : `:${row.model}`;
    priceMap.set(key, row);
  }

  // 加载同步黑名单（复合主键）
  const blacklist = new Set<string>();  // key = "channelId:model" or ":model"
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
    // 查找匹配渠道
    const matchedChannels = providerToChannels.get(price.provider) || [];

    if (matchedChannels.length > 0) {
      // 有匹配渠道 → 逐渠道写入
      for (const ch of matchedChannels) {
        const blKey = `${ch.id}:${price.model}`;
        const priceKey = `${ch.id}:${price.model}`;

        // 黑名单检查
        if (blacklist.has(blKey) || blacklist.has(`:${price.model}`)) {
          console.log(`[PriceSync] 模型 '${price.model}' 渠道 '${ch.name}' 在同步黑名单中，跳过`);
          skipped++;
          continue;
        }

        // 决定写入币种和价格
        // USD 渠道存 USD 原价，CNY 渠道存 CNY 价格
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
          const { randomBytes } = await import("crypto");
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

      // 全局价格统一用 CNY
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
        const { randomBytes } = await import("crypto");
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
