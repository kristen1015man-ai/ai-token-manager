/** 渠道管理页 — 共享类型与常量 */

export interface Channel {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string | string[];
  priority: number;
  status: string;
  currency: string;
  provider: string | null;
  createdAt: string;
  balance: number | null;
  balanceCurrency: string | null;
  balanceSyncMode: string | null;
  balanceSyncedAt: string | null;
  balanceAlertThreshold: number | null;
  accessKeyId: string | null;
  accessKeySecret: string | null;
}

export interface ChannelFormState {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string;
  priority: number;
  status: string;
  currency: string;
  provider: string;
  accessKeyId: string;
  accessKeySecret: string;
}

export const PROVIDERS = [
  { value: "", label: "无（手动管理）" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "glm", label: "智谱 GLM" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "siliconflow", label: "硅基流动" },
  { value: "alibaba", label: "阿里千问" },
];

export const AUTO_PROVIDERS = ["deepseek", "siliconflow", "alibaba"];

export const EMPTY: ChannelFormState = {
  name: "",
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  models: '["deepseek-chat"]',
  priority: 0,
  status: "active",
  currency: "CNY",
  provider: "",
  accessKeyId: "",
  accessKeySecret: "",
};

export const DEFAULT_THRESHOLDS: Record<string, number> = { CNY: 100, USD: 10 };
