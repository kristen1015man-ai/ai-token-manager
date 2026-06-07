/**
 * price-scrapers/helpers.ts — 类型定义、通用工具函数、HTML 表格解析
 */

/** 解析后的价格条目 */
export interface ParsedPrice {
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
export async function fetchPage(url: string): Promise<string> {
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
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 创建 CNY 价格（raw 值 = 主值） */
export function makeCNY(model: string, displayName: string, input: number, output: number, cache: number): ParsedPrice {
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
export function makeUSD(model: string, displayName: string, input: number, output: number, cache: number, rate: number): ParsedPrice {
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

/** 模型匹配模式 */
export interface ModelPattern {
  displayName: string;
  keywords: string[];
}

/** 通用 HTML 表格价格解析 */
export function parseHtmlTablePrices(
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
