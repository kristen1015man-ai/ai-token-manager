/**
 * USD/CNY 汇率获取模块
 *
 * - 双 API fallback：open.er-api.com → exchangerate-api.com → 硬编码 7.2
 * - 24 小时内存缓存，过期后重新获取
 * - API 失败时优先用过期缓存，最后才用硬编码
 * - invalidateRateCache() 供管理后台手动刷新
 */

interface RateResult {
  rate: number;
  source: string;
  fetchedAt: number; // unix ms
}

/** 硬编码兜底汇率 */
const FALLBACK_RATE = 7.2;

/** 缓存有效期：24 小时 */
const CACHE_TTL = 24 * 60 * 60 * 1000;

/** 内存缓存 */
let cached: RateResult | null = null;

/** 正在进行的请求（防止并发重复调用） */
let pending: Promise<RateResult> | null = null;

/**
 * 从 open.er-api.com 获取汇率（免费、无需 key）
 */
async function fetchFromErApi(): Promise<RateResult> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`er-api HTTP ${res.status}`);
  const data = await res.json();
  const rate = data?.rates?.CNY;
  if (typeof rate !== "number" || rate <= 0) throw new Error("er-api: invalid rate");
  return { rate, source: "open.er-api.com", fetchedAt: Date.now() };
}

/**
 * 从 exchangerate-api.com 获取汇率（免费、无需 key）
 */
async function fetchFromExchangeRateApi(): Promise<RateResult> {
  const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD", {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`exchangerate-api HTTP ${res.status}`);
  const data = await res.json();
  const rate = data?.rates?.CNY;
  if (typeof rate !== "number" || rate <= 0) throw new Error("exchangerate-api: invalid rate");
  return { rate, source: "exchangerate-api.com", fetchedAt: Date.now() };
}

/**
 * 获取当前 USD/CNY 汇率
 *
 * 优先级：内存缓存（24h内） → API 1 → API 2 → 过期缓存 → 硬编码 7.2
 */
export async function getUsdCnyRate(): Promise<{ rate: number; source: string }> {
  // 1. 检查缓存是否有效
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return { rate: cached.rate, source: cached.source };
  }

  // 2. 防止并发重复请求
  if (pending) {
    const result = await pending;
    return { rate: result.rate, source: result.source };
  }

  // 3. 发起请求
  pending = (async () => {
    try {
      const result = await fetchFromErApi();
      cached = result;
      return result;
    } catch {
      // fallback 到第二个 API
    }

    try {
      const result = await fetchFromExchangeRateApi();
      cached = result;
      return result;
    } catch {
      // fallback 到过期缓存或硬编码
    }

    if (cached) {
      // 过期缓存优于硬编码
      return cached;
    }

    // 最终兜底
    const fallback: RateResult = {
      rate: FALLBACK_RATE,
      source: "hardcoded",
      fetchedAt: Date.now(),
    };
    cached = fallback;
    return fallback;
  })();

  try {
    const result = await pending;
    return { rate: result.rate, source: result.source };
  } finally {
    pending = null;
  }
}

/**
 * 手动清除缓存，下次调用 getUsdCnyRate() 会重新获取
 */
export function invalidateRateCache(): void {
  cached = null;
  pending = null;
}
