export interface ModelPrice {
  id: string;
  model: string;
  channelId: string | null;
  channelName: string;
  channelCurrency: string | null;
  channelProvider: string | null;
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion: number;
  displayName: string | null;
  currency: string;
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
  channelId: "",
  inputPerMillion: 0,
  outputPerMillion: 0,
  cachePerMillion: 0,
  displayName: "",
};

export type FormState = typeof EMPTY_FORM;
