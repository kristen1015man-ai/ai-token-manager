/**
 * 模型单价表（单位：¥/百万 Token）
 * 后续可在渠道管理页面配置，当前硬编码
 */
export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheHitPerMillion: number;
}

const PRICING_TABLE: Record<string, ModelPrice> = {
  "deepseek-chat": {
    inputPerMillion: 1.0,
    outputPerMillion: 2.0,
    cacheHitPerMillion: 0.1,
  },
  "deepseek-reasoner": {
    inputPerMillion: 4.0,
    outputPerMillion: 16.0,
    cacheHitPerMillion: 0.4,
  },
};

/**
 * 计算单次请求费用
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0
): number {
  const price = PRICING_TABLE[model];
  if (!price) {
    // 未知模型用 deepseek-chat 价格兜底
    const fallback = PRICING_TABLE["deepseek-chat"];
    return (
      ((inputTokens - cachedTokens) * fallback.inputPerMillion +
        cachedTokens * fallback.cacheHitPerMillion +
        outputTokens * fallback.outputPerMillion) /
      1_000_000
    );
  }

  const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
  return (
    (nonCachedInput * price.inputPerMillion +
      cachedTokens * price.cacheHitPerMillion +
      outputTokens * price.outputPerMillion) /
    1_000_000
  );
}

/**
 * 获取所有已知模型列表
 */
export function getKnownModels(): string[] {
  return Object.keys(PRICING_TABLE);
}
