/** 预警管理页 — 共享类型与常量 */

export interface Alert {
  id: string;
  type: string;
  targetId: string;
  message: string;
  sentAt: string;
}

export interface AlertSettings {
  personal_threshold: string;
  dept_threshold: string;
  company_threshold: string;
  anomaly_threshold: string;
  feishu_webhook_url: string;
  feishu_notify_enabled: string;
  feishu_notify_types: string;
}

export const DEFAULT_SETTINGS: AlertSettings = {
  personal_threshold: "80",
  dept_threshold: "80",
  company_threshold: "90",
  anomaly_threshold: "10",
  feishu_webhook_url: "",
  feishu_notify_enabled: "false",
  feishu_notify_types: "personal_80,personal_100,dept_80,company_90,anomaly",
};

export const TYPE_LABELS: Record<string, string> = {
  personal_80: "🟡 个人 80%",
  personal_100: "🔴 个人超额",
  dept_80: "🟠 部门 80%",
  company_90: "🔴 公司 90%",
  anomaly: "⚠️ 异常使用",
};

export const NOTIFY_TYPE_OPTIONS = [
  { key: "personal_80", label: "个人 80% 预警" },
  { key: "personal_100", label: "个人超额预警" },
  { key: "dept_80", label: "部门 80% 预警" },
  { key: "company_90", label: "公司 90% 预警" },
  { key: "anomaly", label: "异常使用预警" },
];
