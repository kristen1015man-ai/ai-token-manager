// ===== 共享 TypeScript 类型定义 =====

export type UserRole = "admin" | "member";
export type UserStatus = "active" | "disabled";
export type ChannelStatus = "active" | "disabled";
export type QuotaScope = "company" | "department" | "personal";
export type AlertType =
  | "personal_80"
  | "personal_100"
  | "dept_80"
  | "company_90"
  | "anomaly";

export interface User {
  id: string;
  feishuId: string;
  name: string;
  avatar: string | null;
  email: string | null;
  department: string | null;
  departmentId: string | null;
  employeeId: string | null;
  apiKey: string;
  role: UserRole;
  status: UserStatus;
  monthlyQuota: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Channel {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
  status: ChannelStatus;
  createdAt: Date;
}

export interface UsageLog {
  id: string;
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  channelId: string;
  createdAt: Date;
}

export interface QuotaRule {
  id: string;
  scope: QuotaScope;
  targetId: string;
  monthlyLimit: number;
  updatedBy: string | null;
  updatedAt: Date;
}

// ===== API 响应类型 =====

export interface UsageSummary {
  todayTokens: number;
  todayCost: number;
  monthTokens: number;
  monthCost: number;
  monthlyQuota: number | null;
  quotaUsed: number;
}

export interface UsageChartData {
  time: string;
  tokens: number;
  cost: number;
}

export interface QuotaExceededError {
  error: {
    message: string;
    type: "quota_exceeded";
    quota_info: {
      used: number;
      limit: number;
      period: string;
      admin_contact: string;
    };
  };
}
