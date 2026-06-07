/** 账单分析页 — 共享类型 */

export interface DeptData {
  department: string;
  userCount: number;
  tokens: number;
  cost: number;
  avgCost: string;
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
