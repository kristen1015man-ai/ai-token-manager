/** 操作日志页 — 共享类型与常量 */

export interface LogEntry {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface FetchResult {
  logs: LogEntry[];
  total: number;
}

export const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create:      { label: "创建", color: "bg-green-50 text-green-700" },
  update:      { label: "更新", color: "bg-blue-50 text-blue-700" },
  delete:      { label: "删除", color: "bg-red-50 text-red-700" },
  toggle:      { label: "切换", color: "bg-purple-50 text-purple-700" },
  sync:        { label: "同步", color: "bg-cyan-50 text-cyan-700" },
  export:      { label: "导出", color: "bg-amber-50 text-amber-700" },
  migrate:     { label: "迁移", color: "bg-orange-50 text-orange-700" },
  reset_key:   { label: "重置Key", color: "bg-pink-50 text-pink-700" },
  batch_update:{ label: "批量更新", color: "bg-indigo-50 text-indigo-700" },
};

export const TARGET_LABELS: Record<string, { label: string; color: string }> = {
  channel:        { label: "渠道", color: "bg-sky-50 text-sky-700" },
  user:           { label: "用户", color: "bg-violet-50 text-violet-700" },
  model:          { label: "模型", color: "bg-teal-50 text-teal-700" },
  price:          { label: "价格", color: "bg-emerald-50 text-emerald-700" },
  quota:          { label: "限额", color: "bg-yellow-50 text-yellow-700" },
  permission:     { label: "权限", color: "bg-fuchsia-50 text-fuchsia-700" },
  department:     { label: "部门", color: "bg-lime-50 text-lime-700" },
  employee:       { label: "员工", color: "bg-rose-50 text-rose-700" },
  org_structure:  { label: "组织架构", color: "bg-stone-50 text-stone-700" },
  alert_setting:  { label: "预警设置", color: "bg-orange-50 text-orange-700" },
  exchange_rate:  { label: "汇率", color: "bg-cyan-50 text-cyan-700" },
  billing:        { label: "账单", color: "bg-indigo-50 text-indigo-700" },
  system:         { label: "系统", color: "bg-gray-100 text-gray-700" },
};

export const PAGE_SIZE = 20;
