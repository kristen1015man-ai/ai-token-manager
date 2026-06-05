/**
 * 多供应商模型价格自动同步模块
 *
 * 支持从以下供应商官网抓取最新价格：
 * - DeepSeek（https://api-docs.deepseek.com/zh-cn/quick_start/pricing）
 * - 智谱 GLM（https://open.bigmodel.cn/pricing）
 * - OpenAI（https://openai.com/api/pricing/）
 * - Anthropic（https://platform.claude.com/docs/en/about-claude/pricing）
 *
 * 同步策略：
 * - syncedAt 不为 null 的行 → 允许被官网同步覆盖
 * - syncedAt 为 null 的行 → 手动编辑过，不覆盖
 * - 官网有但 DB 没有的新模型 → 自动插入
 *
 * USD 价格按汇率转换为 ¥（人民币），汇率可通过 USD_CNY_RATE 配置
 */

import { getDb, saveDb } from "./db";
import { modelPrices } from "../../../shared/schema";
import { eq } from "drizzle-orm";

/** USD → ¥ 汇率（2026年6月，约7.2） */
const USD_CNY_RATE = 7.2;

/** 解析后的价格条目 */
interface ParsedPrice {
  model: string;
  inputPerMillion: number;   // ¥/M tokens
  outputPerMillion: number;  // ¥/M tokens
  cachePerMillion: number;   // ¥/M tokens
  displayName: string;
  provider: string;          // 供应商标识
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

// ============================================================
// DeepSeek 价格抓取
// ============================================================
async function fetchDeepSeekPrices(): Promise<ParsedPrice[]> {
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

    // 兜底：已知价格
    console.warn("[PriceSync] DeepSeek HTML 解析为空，使用兜底价格");
    return [
      { model: "deepseek-v4-flash", inputPerMillion: 1, outputPerMillion: 2, cachePerMillion: 0.02, displayName: "DeepSeek V4 Flash", provider: "deepseek" },
      { model: "deepseek-v4-pro", inputPerMillion: 3, outputPerMillion: 6, cachePerMillion: 0.025, displayName: "DeepSeek V4 Pro", provider: "deepseek" },
    ];
  } catch (err) {
    console.error("[PriceSync] DeepSeek 抓取失败:", err);
    return [
      { model: "deepseek-v4-flash", inputPerMillion: 1, outputPerMillion: 2, cachePerMillion: 0.02, displayName: "DeepSeek V4 Flash", provider: "deepseek" },
      { model: "deepseek-v4-pro", inputPerMillion: 3, outputPerMillion: 6, cachePerMillion: 0.025, displayName: "DeepSeek V4 Pro", provider: "deepseek" },
    ];
  }
}

// ============================================================
// 智谱 GLM 价格抓取
// ============================================================
async function fetchGLMPrices(): Promise<ParsedPrice[]> {
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
      { model: "glm-5.1", inputPerMillion: 6, outputPerMillion: 24, cachePerMillion: 0.5, displayName: "GLM-5.1", provider: "glm" },
      { model: "glm-4-plus", inputPerMillion: 50, outputPerMillion: 50, cachePerMillion: 0, displayName: "GLM-4 Plus", provider: "glm" },
      { model: "glm-4-flash", inputPerMillion: 0.1, outputPerMillion: 0.1, cachePerMillion: 0, displayName: "GLM-4 Flash", provider: "glm" },
    ];
  } catch (err) {
    console.error("[PriceSync] GLM 抓取失败:", err);
    return [
      { model: "glm-5.1", inputPerMillion: 6, outputPerMillion: 24, cachePerMillion: 0.5, displayName: "GLM-5.1", provider: "glm" },
      { model: "glm-4-plus", inputPerMillion: 50, outputPerMillion: 50, cachePerMillion: 0, displayName: "GLM-4 Plus", provider: "glm" },
      { model: "glm-4-flash", inputPerMillion: 0.1, outputPerMillion: 0.1, cachePerMillion: 0, displayName: "GLM-4 Flash", provider: "glm" },
    ];
  }
}

// ============================================================
// OpenAI 价格抓取
// ============================================================
async function fetchOpenAIPrices(): Promise<ParsedPrice[]> {
  try {
    const url = "https://openai.com/api/pricing/";
    const html = await fetchPage(url);
    const text = html.replace(/<[^>]+>/g, " ").toLowerCase();

    // OpenAI 定价页是 JS 渲染的，HTML 里可能没有完整数据
    // 尝试从页面文本中提取
    const prices: ParsedPrice[] = [];

    // 查找 GPT-5.5 价格上下文
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
          prices.push({
            model,
            inputPerMillion: Math.round(nums[0] * USD_CNY_RATE * 100) / 100,
            outputPerMillion: Math.round(nums[1] * USD_CNY_RATE * 100) / 100,
            cachePerMillion: nums.length >= 3 ? Math.round(nums[2] * USD_CNY_RATE * 100) / 100 : Math.round(nums[0] * 0.1 * USD_CNY_RATE * 100) / 100,
            displayName,
            provider: "openai",
          });
          return;
        }
      }
    };

    tryExtract("gpt-5.5", "GPT-5.5", ["gpt-5.5", "gpt 5.5"]);
    tryExtract("gpt-4o", "GPT-4o", ["gpt-4o", "gpt 4o"]);
    tryExtract("gpt-4o-mini", "GPT-4o Mini", ["gpt-4o-mini", "gpt-4o mini", "gpt4omini"]);

    if (prices.length > 0) return prices;

    // 兜底：已知价格（2026年6月，USD → ¥）
    console.warn("[PriceSync] OpenAI HTML 解析为空，使用兜底价格");
    return [
      { model: "gpt-5.5", inputPerMillion: 36, outputPerMillion: 216, cachePerMillion: 3.6, displayName: "GPT-5.5", provider: "openai" },
      { model: "gpt-4o", inputPerMillion: 17.5, outputPerMillion: 60, cachePerMillion: 1.75, displayName: "GPT-4o", provider: "openai" },
      { model: "gpt-4o-mini", inputPerMillion: 1.05, outputPerMillion: 4.2, cachePerMillion: 0.105, displayName: "GPT-4o Mini", provider: "openai" },
    ];
  } catch (err) {
    console.error("[PriceSync] OpenAI 抓取失败:", err);
    // fetch 本身失败（如 403）也要返回兜底价格
    return [
      { model: "gpt-5.5", inputPerMillion: 36, outputPerMillion: 216, cachePerMillion: 3.6, displayName: "GPT-5.5", provider: "openai" },
      { model: "gpt-4o", inputPerMillion: 17.5, outputPerMillion: 60, cachePerMillion: 1.75, displayName: "GPT-4o", provider: "openai" },
      { model: "gpt-4o-mini", inputPerMillion: 1.05, outputPerMillion: 4.2, cachePerMillion: 0.105, displayName: "GPT-4o Mini", provider: "openai" },
    ];
  }
}

// ============================================================
// Anthropic 价格抓取
// ============================================================
async function fetchAnthropicPrices(): Promise<ParsedPrice[]> {
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
          prices.push({
            model,
            inputPerMillion: Math.round(nums[0] * USD_CNY_RATE * 100) / 100,
            outputPerMillion: Math.round(nums[1] * USD_CNY_RATE * 100) / 100,
            cachePerMillion: nums.length >= 3 ? Math.round(nums[2] * USD_CNY_RATE * 100) / 100 : Math.round(nums[0] * 0.1 * USD_CNY_RATE * 100) / 100,
            displayName,
            provider: "anthropic",
          });
          return;
        }
      }
    };

    tryExtract("claude-opus-4-8", "Claude Opus 4.8", ["opus 4.8", "opus-4-8", "opus4.8"]);
    tryExtract("claude-sonnet-4-6", "Claude Sonnet 4.6", ["sonnet 4.6", "sonnet-4-6", "sonnet4.6"]);
    tryExtract("claude-haiku-4-5", "Claude Haiku 4.5", ["haiku 4.5", "haiku-4-5"]);

    if (prices.length > 0) return prices;

    // 兜底：已知价格（2026年6月，USD → ¥）
    console.warn("[PriceSync] Anthropic HTML 解析为空，使用兜底价格");
    return [
      { model: "claude-opus-4-8", inputPerMillion: 36, outputPerMillion: 180, cachePerMillion: 3.6, displayName: "Claude Opus 4.8", provider: "anthropic" },
      { model: "claude-sonnet-4-6", inputPerMillion: 21.6, outputPerMillion: 108, cachePerMillion: 2.16, displayName: "Claude Sonnet 4.6", provider: "anthropic" },
      { model: "claude-haiku-4-5", inputPerMillion: 7.2, outputPerMillion: 36, cachePerMillion: 0.72, displayName: "Claude Haiku 4.5", provider: "anthropic" },
    ];
  } catch (err) {
    console.error("[PriceSync] Anthropic 抓取失败:", err);
    return [
      { model: "claude-opus-4-8", inputPerMillion: 36, outputPerMillion: 180, cachePerMillion: 3.6, displayName: "Claude Opus 4.8", provider: "anthropic" },
      { model: "claude-sonnet-4-6", inputPerMillion: 21.6, outputPerMillion: 108, cachePerMillion: 2.16, displayName: "Claude Sonnet 4.6", provider: "anthropic" },
      { model: "claude-haiku-4-5", inputPerMillion: 7.2, outputPerMillion: 36, cachePerMillion: 0.72, displayName: "Claude Haiku 4.5", provider: "anthropic" },
    ];
  }
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
          prices.push({
            model: modelId,
            inputPerMillion: numbers[0],
            outputPerMillion: numbers[1],
            cachePerMillion: numbers.length >= 3 ? numbers[2] : numbers[0] * 0.1,
            displayName: pattern.displayName,
            provider: providerPrefix,
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
  const allPrices = await Promise.all([
    fetchDeepSeekPrices(),
    fetchGLMPrices(),
    fetchOpenAIPrices(),
    fetchAnthropicPrices(),
  ]);

  return allPrices.flat();
}

/**
 * 执行价格同步：对比官网价格与数据库，更新允许同步的全局价格行
 *
 * 规则：
 * - 只同步全局价格（channel_id IS NULL 的行）
 * - syncedAt 不为 null → 允许被官网同步覆盖
 * - syncedAt 为 null → 手动编辑过，不覆盖
 * - 新模型插入前检查 sync_blacklist，在黑名单中的跳过
 * - 插入的新模型 channel_id = NULL（全局价格）
 *
 * @returns updated 更新的行数, added 新增的行数, skipped 黑名单跳过的行数, providers 抓取的供应商列表
 */
export async function syncPricesFromOfficial(): Promise<{
  updated: number;
  added: number;
  skipped: number;
  providers: string[];
}> {
  const officialPrices = await fetchOfficialPrices();

  if (officialPrices.length === 0) {
    throw new Error("所有供应商价格解析结果为空，可能网络问题或页面结构变化");
  }

  // 统计成功的供应商
  const providers = [...new Set(officialPrices.map((p) => p.provider))];

  const { db, sqlite } = await getDb();
  const dbAny = sqlite as any;

  // 只加载全局价格（channel_id IS NULL）用于同步比对
  const existing = await db.select().from(modelPrices);
  const globalMap = new Map<string, typeof existing[0]>();
  for (const row of existing) {
    if (row.channelId === null || row.channelId === undefined) {
      globalMap.set(row.model, row);
    }
  }

  // 加载同步黑名单
  const blacklist = new Set<string>();
  try {
    const blRows = dbAny.exec("SELECT model FROM sync_blacklist");
    for (const r of (blRows[0]?.values ?? [])) {
      blacklist.add(String(r[0]));
    }
  } catch { /* sync_blacklist 表可能还不存在 */ }

  let updated = 0;
  let added = 0;
  let skipped = 0;

  for (const price of officialPrices) {
    // 检查黑名单：被删除过的模型不再同步回来
    if (blacklist.has(price.model)) {
      console.log(`[PriceSync] 模型 '${price.model}' 在同步黑名单中，跳过`);
      skipped++;
      continue;
    }

    const row = globalMap.get(price.model);

    if (row) {
      // 只更新 syncedAt 不为 null 的行（即未被手动编辑过的）
      if (row.syncedAt !== null) {
        await db
          .update(modelPrices)
          .set({
            inputPerMillion: price.inputPerMillion,
            outputPerMillion: price.outputPerMillion,
            cachePerMillion: price.cachePerMillion,
            displayName: price.displayName,
            syncedAt: new Date(),
            updatedBy: "auto-sync",
            updatedAt: new Date(),
          })
          .where(eq(modelPrices.id, row.id));
        updated++;
      }
    } else {
      // 新模型，自动插入全局价格（channel_id = NULL）
      const { randomBytes } = await import("crypto");
      await db.insert(modelPrices).values({
        id: `price_${randomBytes(6).toString("hex")}`,
        model: price.model,
        channelId: null,
        inputPerMillion: price.inputPerMillion,
        outputPerMillion: price.outputPerMillion,
        cachePerMillion: price.cachePerMillion,
        displayName: price.displayName,
        deprecated: false,
        syncedAt: new Date(),
        updatedBy: "auto-sync",
        updatedAt: new Date(),
        createdAt: new Date(),
      });
      added++;
    }
  }

  await saveDb();

  // 清除代理进程的价格缓存
  try {
    const { invalidatePriceCache } = await import("./proxy");
    invalidatePriceCache();
  } catch { /* 非 proxy 进程时忽略 */ }

  return { updated, added, skipped, providers };
}
