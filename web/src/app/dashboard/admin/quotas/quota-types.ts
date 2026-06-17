/** 配额管理页 — 共享类型与常量 */

export interface UserInfo {
  id: string;
  name: string;
  avatar: string | null;
  department: string | null;
  monthlyQuota: number;
}

/** 部门颜色映射 */
export const DEPT_COLORS: Record<string, string> = {
  "运营部": "bg-blue-50 text-blue-700",
  "经管部": "bg-violet-50 text-violet-700",
  "IT部": "bg-emerald-50 text-emerald-700",
  "产品部": "bg-amber-50 text-amber-700",
  "仓储物流部": "bg-cyan-50 text-cyan-700",
  "设计部": "bg-pink-50 text-pink-700",
  "品质部": "bg-teal-50 text-teal-700",
  "品牌部": "bg-rose-50 text-rose-700",
  "财务部": "bg-indigo-50 text-indigo-700",
  "人力行政部": "bg-orange-50 text-orange-700",
  "采购寻源部": "bg-lime-50 text-lime-700",
  "采购跟单部": "bg-sky-50 text-sky-700",
  "计划部": "bg-purple-50 text-purple-700",
};

export const DEFAULT_DEPT = "bg-gray-50 text-gray-600";
