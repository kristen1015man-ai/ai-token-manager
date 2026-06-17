export interface ParsedPrice {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion: number;
  displayName: string;
  provider: string;
  currency: "CNY" | "USD";
  rawInputPerMillion: number;
  rawOutputPerMillion: number;
  rawCachePerMillion: number;
  source: "official" | "fallback";
}

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

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function makeCNY(
  model: string,
  displayName: string,
  input: number,
  output: number,
  cache: number,
  source: "official" | "fallback" = "fallback",
): ParsedPrice {
  return {
    model,
    inputPerMillion: input,
    outputPerMillion: output,
    cachePerMillion: cache,
    displayName,
    provider: "deepseek",
    currency: "CNY",
    rawInputPerMillion: input,
    rawOutputPerMillion: output,
    rawCachePerMillion: cache,
    source,
  };
}

export function makeUSD(
  model: string,
  displayName: string,
  input: number,
  output: number,
  cache: number,
  rate: number,
  source: "official" | "fallback" = "fallback",
): ParsedPrice {
  return {
    model,
    inputPerMillion: r2(input * rate),
    outputPerMillion: r2(output * rate),
    cachePerMillion: r2(cache * rate),
    displayName,
    provider: "openai",
    currency: "USD",
    rawInputPerMillion: input,
    rawOutputPerMillion: output,
    rawCachePerMillion: cache,
    source,
  };
}

export interface ModelPattern {
  displayName: string;
  keywords: string[];
}

export function parseHtmlTablePrices(
  html: string,
  providerPrefix: string,
  modelPatterns: Record<string, ModelPattern>,
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
        cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
      }

      if (headerMode) {
        headerMode = false;
        continue;
      }
      if (cells.length < 3) continue;

      const numbers = cells.slice(1)
        .map((cell) => {
          const match = cell.match(/([\d.]+)/);
          return match ? parseFloat(match[1]) : NaN;
        })
        .filter((value) => !Number.isNaN(value));
      if (numbers.length < 2) continue;

      const modelStr = cells[0].toLowerCase().trim();
      for (const [modelId, pattern] of Object.entries(modelPatterns)) {
        if (!pattern.keywords.every((keyword) => modelStr.includes(keyword))) continue;
        const input = numbers[0];
        const output = numbers[1];
        const cache = numbers.length >= 3 ? numbers[2] : input * 0.1;
        const isUSD = ["openai", "anthropic"].includes(providerPrefix);
        prices.push({
          model: modelId,
          inputPerMillion: input,
          outputPerMillion: output,
          cachePerMillion: cache,
          displayName: pattern.displayName,
          provider: providerPrefix,
          currency: isUSD ? "USD" : "CNY",
          rawInputPerMillion: input,
          rawOutputPerMillion: output,
          rawCachePerMillion: cache,
          source: "official",
        });
        break;
      }
    }
  }

  return prices;
}
