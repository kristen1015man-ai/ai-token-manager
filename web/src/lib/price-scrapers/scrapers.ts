import { fetchPage, makeCNY, makeUSD, parseHtmlTablePrices, type ParsedPrice } from "./helpers";

export async function fetchDeepSeekPrices(_rate: number): Promise<ParsedPrice[]> {
  try {
    const html = await fetchPage("https://api-docs.deepseek.com/zh-cn/quick_start/pricing");
    const v4Prices = parseDeepSeekV4Prices(html);
    if (v4Prices.length > 0) return v4Prices;

    const prices = parseHtmlTablePrices(html, "deepseek", {
      "deepseek-v4-flash": { displayName: "DeepSeek V4 Flash", keywords: ["v4", "flash"] },
      "deepseek-v4-pro": { displayName: "DeepSeek V4 Pro", keywords: ["v4", "pro"] },
      "deepseek-chat": { displayName: "DeepSeek Chat", keywords: ["chat"] },
      "deepseek-reasoner": { displayName: "DeepSeek Reasoner", keywords: ["reasoner"] },
    });
    if (prices.length > 0) return prices;

    console.warn("[PriceSync] DeepSeek price parser returned empty, using fallback prices");
  } catch (err) {
    console.error("[PriceSync] DeepSeek price fetch failed:", err);
  }

  return [
    makeCNY("deepseek-v4-flash", "DeepSeek V4 Flash", 1, 2, 0.02),
    makeCNY("deepseek-v4-pro", "DeepSeek V4 Pro", 3, 6, 0.025),
  ];
}

export async function fetchGLMPrices(_rate: number): Promise<ParsedPrice[]> {
  try {
    const html = await fetchPage("https://open.bigmodel.cn/pricing");
    const prices = parseHtmlTablePrices(html, "glm", {
      "glm-5.1": { displayName: "GLM-5.1", keywords: ["glm-5", "5.1"] },
      "glm-4-plus": { displayName: "GLM-4 Plus", keywords: ["4-plus", "4plus"] },
      "glm-4-flash": { displayName: "GLM-4 Flash", keywords: ["4-flash", "4flash"] },
    }).map((price) => ({ ...price, provider: "glm" }));
    if (prices.length > 0) return prices;

    console.warn("[PriceSync] GLM price parser returned empty, using fallback prices");
  } catch (err) {
    console.error("[PriceSync] GLM price fetch failed:", err);
  }

  return [
    makeCNY("glm-5.1", "GLM-5.1", 6, 24, 0.5),
    makeCNY("glm-4-plus", "GLM-4 Plus", 50, 50, 0),
    makeCNY("glm-4-flash", "GLM-4 Flash", 0.1, 0.1, 0),
  ].map((price) => ({ ...price, provider: "glm" }));
}

export async function fetchOpenAIPrices(rate: number): Promise<ParsedPrice[]> {
  const fallbacks: Array<[string, string, number, number, number]> = [
    ["gpt-5.5", "GPT-5.5", 5, 30, 0.5],
    ["gpt-4o", "GPT-4o", 2.5, 10, 0.25],
    ["gpt-4o-mini", "GPT-4o Mini", 0.15, 0.6, 0.015],
  ];

  try {
    const html = await fetchPage("https://openai.com/api/pricing/");
    const text = html.replace(/<[^>]+>/g, " ").toLowerCase();
    const prices: ParsedPrice[] = [];

    const extractUSD = (context: string): number[] =>
      (context.match(/\$?([\d.]+)\s*\/\s*1m/gi) || [])
        .map((s) => Number(s.match(/([\d.]+)/)?.[1] || 0))
        .filter((n) => n > 0);

    const tryExtract = (model: string, displayName: string, searchTerms: string[]) => {
      for (const term of searchTerms) {
        const idx = text.indexOf(term);
        if (idx === -1) continue;
        const nums = extractUSD(text.slice(Math.max(0, idx - 100), idx + 300));
        if (nums.length >= 2) {
          prices.push(makeUSD(model, displayName, nums[0], nums[1], nums[2] ?? nums[0] * 0.1, rate, "official"));
          return;
        }
      }
    };

    tryExtract("gpt-5.5", "GPT-5.5", ["gpt-5.5", "gpt 5.5"]);
    tryExtract("gpt-4o", "GPT-4o", ["gpt-4o", "gpt 4o"]);
    tryExtract("gpt-4o-mini", "GPT-4o Mini", ["gpt-4o-mini", "gpt-4o mini", "gpt4omini"]);
    if (prices.length > 0) return prices;

    console.warn("[PriceSync] OpenAI price parser returned empty, using fallback prices");
  } catch (err) {
    console.error("[PriceSync] OpenAI price fetch failed:", err);
  }

  return fallbacks.map(([model, name, input, output, cache]) => makeUSD(model, name, input, output, cache, rate));
}

export async function fetchAnthropicPrices(rate: number): Promise<ParsedPrice[]> {
  const fallbacks: Array<[string, string, number, number, number]> = [
    ["claude-opus-4-8", "Claude Opus 4.8", 5, 25, 0.5],
    ["claude-sonnet-4-6", "Claude Sonnet 4.6", 3, 15, 0.3],
    ["claude-haiku-4-5", "Claude Haiku 4.5", 1, 5, 0.1],
  ];

  try {
    const html = await fetchPage("https://platform.claude.com/docs/en/about-claude/pricing");
    const text = html.replace(/<[^>]+>/g, " ").toLowerCase();
    const prices: ParsedPrice[] = [];

    const extractUSD = (context: string): number[] =>
      (context.match(/\$?([\d.]+)\s*(?:\/\s*)?(?:per\s*)?(?:1m|m\b)/gi) || [])
        .map((s) => Number(s.match(/([\d.]+)/)?.[1] || 0))
        .filter((n) => n > 0);

    const tryExtract = (model: string, displayName: string, searchTerms: string[]) => {
      for (const term of searchTerms) {
        const idx = text.indexOf(term);
        if (idx === -1) continue;
        const nums = extractUSD(text.slice(Math.max(0, idx - 100), idx + 300));
        if (nums.length >= 2) {
          const price = makeUSD(model, displayName, nums[0], nums[1], nums[2] ?? nums[0] * 0.1, rate, "official");
          price.provider = "anthropic";
          prices.push(price);
          return;
        }
      }
    };

    tryExtract("claude-opus-4-8", "Claude Opus 4.8", ["opus 4.8", "opus-4-8", "opus4.8"]);
    tryExtract("claude-sonnet-4-6", "Claude Sonnet 4.6", ["sonnet 4.6", "sonnet-4-6", "sonnet4.6"]);
    tryExtract("claude-haiku-4-5", "Claude Haiku 4.5", ["haiku 4.5", "haiku-4-5"]);
    if (prices.length > 0) return prices;

    console.warn("[PriceSync] Anthropic price parser returned empty, using fallback prices");
  } catch (err) {
    console.error("[PriceSync] Anthropic price fetch failed:", err);
  }

  return fallbacks.map(([model, name, input, output, cache]) => {
    const price = makeUSD(model, name, input, output, cache, rate);
    price.provider = "anthropic";
    return price;
  });
}

export async function fetchSiliconFlowPrices(_rate: number): Promise<ParsedPrice[]> {
  try {
    const html = await fetchPage("https://siliconflow.cn/pricing");
    const gridPrices = parseSiliconFlowGridPrices(html);
    if (gridPrices.length > 0) return mergeSiliconFlowFallbacks(gridPrices);

    const prices = parseHtmlTablePrices(html, "siliconflow", {
      "deepseek-v4-flash": { displayName: "DeepSeek V4 Flash (硅基)", keywords: ["deepseek", "v4", "flash"] },
      "deepseek-v4-pro": { displayName: "DeepSeek V4 Pro (硅基)", keywords: ["deepseek", "v4", "pro"] },
      "deepseek-reasoner": { displayName: "DeepSeek Reasoner (硅基)", keywords: ["deepseek", "reasoner"] },
      "qwen3-235b-a22b": { displayName: "Qwen3 235B (硅基)", keywords: ["qwen3", "235"] },
    }).map((price) => ({ ...price, provider: "siliconflow" }));
    if (prices.length > 0) return prices;

    console.warn("[PriceSync] SiliconFlow price parser returned empty, using fallback prices");
  } catch (err) {
    console.error("[PriceSync] SiliconFlow price fetch failed:", err);
  }

  return siliconFlowFallbacks();
}

function parseDeepSeekV4Prices(html: string): ParsedPrice[] {
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const hit = /百万\s*tokens\s*输入（缓存命中）\s*([\d.]+)\s*元\s*([\d.]+)\s*元/.exec(plain);
  const miss = /百万\s*tokens\s*输入（缓存未命中）\s*([\d.]+)\s*元\s*([\d.]+)\s*元/.exec(plain);
  const output = /百万\s*tokens\s*输出\s*([\d.]+)\s*元\s*([\d.]+)\s*元/.exec(plain);
  if (!hit || !miss || !output) return [];

  return [
    makeCNY("deepseek-v4-flash", "DeepSeek V4 Flash", Number(miss[1]), Number(output[1]), Number(hit[1]), "official"),
    makeCNY("deepseek-v4-pro", "DeepSeek V4 Pro", Number(miss[2]), Number(output[2]), Number(hit[2]), "official"),
  ];
}

function parseSiliconFlowGridPrices(html: string): ParsedPrice[] {
  const definitions = [
    { title: "deepseek-ai/DeepSeek-V4-Flash", model: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash (硅基)" },
    { title: "deepseek-ai/DeepSeek-V4-Pro", model: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro (硅基)" },
    { title: "deepseek-ai/DeepSeek-V3.2", model: "deepseek-v3.2", displayName: "DeepSeek V3.2 (硅基)" },
  ];
  const prices: ParsedPrice[] = [];

  for (const def of definitions) {
    const idx = html.toLowerCase().indexOf(`title="${def.title.toLowerCase()}"`);
    if (idx < 0) continue;
    const context = html.slice(idx, idx + 2200);
    const nums = [...context.matchAll(/¥\s*([\d.]+)/g)]
      .slice(0, 3)
      .map((match) => Number(match[1]));
    if (nums.length < 2 || nums.some((n) => !Number.isFinite(n))) continue;
    const price = makeCNY(def.model, def.displayName, nums[0], nums[1], nums[2] ?? nums[0] * 0.1, "official");
    price.provider = "siliconflow";
    prices.push(price);
  }

  return prices;
}

function siliconFlowFallbacks(): ParsedPrice[] {
  return [
    makeCNY("deepseek-v4-flash", "DeepSeek V4 Flash (硅基)", 1, 2, 0.02),
    makeCNY("deepseek-v4-pro", "DeepSeek V4 Pro (硅基)", 3, 6, 0.03),
    makeCNY("deepseek-reasoner", "DeepSeek Reasoner (硅基)", 6, 24, 0.6),
    makeCNY("qwen3-235b-a22b", "Qwen3 235B (硅基)", 2, 8, 0.2),
  ].map((price) => {
    price.provider = "siliconflow";
    return price;
  });
}

function mergeSiliconFlowFallbacks(officialPrices: ParsedPrice[]): ParsedPrice[] {
  const byModel = new Set(officialPrices.map((price) => price.model));
  return [
    ...officialPrices,
    ...siliconFlowFallbacks().filter((price) => !byModel.has(price.model)),
  ];
}
