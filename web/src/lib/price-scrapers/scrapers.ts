/**
 * price-scrapers/scrapers.ts — 各供应商价格抓取实现
 */
import { fetchPage, r2, makeCNY, makeUSD, parseHtmlTablePrices, type ParsedPrice } from "./helpers";

// ============================================================
// DeepSeek 价格抓取（CNY）
// ============================================================
export async function fetchDeepSeekPrices(rate: number): Promise<ParsedPrice[]> {
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
export async function fetchGLMPrices(rate: number): Promise<ParsedPrice[]> {
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
export async function fetchOpenAIPrices(rate: number): Promise<ParsedPrice[]> {
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
export async function fetchAnthropicPrices(rate: number): Promise<ParsedPrice[]> {
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
export async function fetchSiliconFlowPrices(rate: number): Promise<ParsedPrice[]> {
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
