/** 全局概览页 — 共享类型 */

export interface Overview {
  cost: number;
  tokens: number;
  count: number;
  activeUsers: number;
  rangeLabel: string;
  trend: { day: string; tokens: number; cost: number }[];
}

export interface ChannelData {
  channelId: string;
  channelName: string;
  channelCurrency: string;
  tokens: number;
  cost: number;
  count: number;
}

export interface ModelData {
  model: string;
  tokens: number;
  cost: number;
  count: number;
}

export interface BalanceChannel {
  id: string;
  name: string;
  provider: string | null;
  currency: string;
  balance: number | null;
  balanceCurrency: string | null;
  balanceSyncedAt: string | null;
}

export interface BalanceAlert {
  channelId: string;
  channelName: string;
  provider: string | null;
  balance: number | null;
  currency: string;
  threshold: number;
  severity: "warning" | "danger";
}

export interface BalanceSummary {
  channels: BalanceChannel[];
  totals: Record<string, number>;
  alerts: BalanceAlert[];
}
