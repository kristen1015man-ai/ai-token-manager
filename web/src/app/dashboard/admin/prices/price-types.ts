/** 价格管理页 — 共享类型与常量 */

export interface ModelPrice {
  id: string;
  model: string;
  channelId: string | null;
  channelName: string;
  channelCurrency: string | null;   // "CNY" | "USD" | null
  channelProvider: string | null;
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion: number;
  displayName: string | null;
  currency: string;                  // 价格的原始币种
  deprecated: boolean;
  syncedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface Channel {
  id: string;
  name: string;
  currency: string;
  provider: string | null;
}

export interface ExchangeRate {
  rate: number;
  source: string;
}

export const EMPTY_FORM = {
  model: "",
  channelId: "" as string,
  inputPerMillion: 0,
  outputPerMillion: 0,
  cachePerMillion: 0,
  displayName: "",
};

export type FormState = typeof EMPTY_FORM;
