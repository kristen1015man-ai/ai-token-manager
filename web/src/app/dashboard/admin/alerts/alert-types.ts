/** 预警管理页 — 共享类型与常量 */

export interface Alert {
  id: string;
  type: string;
  targetId: string;
  message: string;
  sentAt: string;
}

export interface AdminOption {
  id: string;
  name: string;
  department: string | null;
}

export interface AlertSettings {
  personal_threshold: string;
  dept_threshold: string;
  company_threshold: string;
  anomaly_threshold: string;
  feishu_webhook_url: string; // 保留向下兼容，不再使用
  feishu_notify_enabled: string;
  feishu_notify_types: string;
  // 管理员接收人（JSON 数组字符串，存 user ID）
  notify_recipients_dept_80: string;
  notify_recipients_company_90: string;
  notify_recipients_anomaly: string;
  notify_recipients_balance_low: string;
  notify_recipients_employee_departed: string;
  // 排行榜设置
  leaderboard_enabled: string;
  leaderboard_chat_ids: string;
  leaderboard_schedule: string;
  leaderboard_send_day: string;
}

export const DEFAULT_SETTINGS: AlertSettings = {
  personal_threshold: "80",
  dept_threshold: "80",
  company_threshold: "90",
  anomaly_threshold: "10",
  feishu_webhook_url: "",
  feishu_notify_enabled: "false",
  feishu_notify_types: "personal_80,personal_100,dept_80,company_90,anomaly,balance_low,employee_departed",
  notify_recipients_dept_80: "[]",
  notify_recipients_company_90: "[]",
  notify_recipients_anomaly: "[]",
  notify_recipients_balance_low: "[]",
  notify_recipients_employee_departed: "[]",
  leaderboard_enabled: "false",
  leaderboard_chat_ids: "[]",
  leaderboard_schedule: "disabled",
  leaderboard_send_day: "1",
};

export const TYPE_LABELS: Record<string, string> = {
  personal_80: "🟡 个人 80%",
  personal_100: "🔴 个人超额",
  dept_80: "🟠 部门 80%",
  company_90: "🔴 公司 90%",
  anomaly: "⚠️ 异常使用",
  balance_low: "💰 余额不足（低于阈值）",
  employee_departed: "👤 员工离职",
  leaderboard: "🏆 排行榜",
};

/** 每种通知类型的详细信息 */
export interface NotifyTypeInfo {
  key: string;
  label: string;
  desc: string;
  /** 是否有管理员接收人选择（个人类型不需要） */
  hasRecipients: boolean;
  /** 对应的 settings key（notify_recipients_{type}） */
  recipientsKey?: string;
}

export const NOTIFY_TYPE_OPTIONS: NotifyTypeInfo[] = [
  { key: "personal_80", label: "个人 80% 预警", desc: "发给个人私聊", hasRecipients: false },
  { key: "personal_100", label: "个人超额预警", desc: "发给个人私聊", hasRecipients: false },
  { key: "dept_80", label: "部门 80% 预警", desc: "部门额度预警", hasRecipients: true, recipientsKey: "notify_recipients_dept_80" },
  { key: "company_90", label: "公司 90% 预警", desc: "公司额度预警", hasRecipients: true, recipientsKey: "notify_recipients_company_90" },
  { key: "anomaly", label: "异常使用预警", desc: "用量异常检测", hasRecipients: true, recipientsKey: "notify_recipients_anomaly" },
  { key: "balance_low", label: "余额不足预警", desc: "渠道余额告警", hasRecipients: true, recipientsKey: "notify_recipients_balance_low" },
  { key: "employee_departed", label: "员工离职通知", desc: "员工状态检查", hasRecipients: true, recipientsKey: "notify_recipients_employee_departed" },
];
