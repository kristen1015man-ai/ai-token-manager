// ===== 部门规范化映射表 =====

export type DeptLevel = "center" | "department" | "group";

/** 组名 → 归属部门 */
export const GROUP_TO_DEPT: Record<string, string> = {
  "产品一组": "产品部", "产品二组": "产品部",
  "ID设计组": "产品部", "结构设计组": "产品部", "项目管理": "产品部",
  "开发组": "IT部", "运维组": "IT部", "产品组": "IT部",
  "市场组": "经管部",
  "运营一部一组": "运营部", "运营一部二组": "运营部", "运营一部三组": "运营部",
  "运营一部四组": "运营部", "运营一部五组": "运营部",
  "运营二部一组": "运营部", "运营二部二组": "运营部", "运营二部三组": "运营部",
  "运营二部四组": "运营部", "运营二部五组": "运营部",
  "CPC广告": "运营部", "营销中心支持组": "运营部",
  "仓储组": "仓储物流部", "物流组": "仓储物流部",
};

/** 不规则部门名 → 标准部门名 */
export const DEPT_RENAME: Record<string, string> = {
  "开发部": "产品部", "市场": "经管部", "开发组": "IT部",
  "产品一组": "产品部", "产品二组": "产品部",
  "物流组": "仓储物流部",
  "运营一部一组": "运营部", "运营一部二组": "运营部", "运营二部一组": "运营部",
  "运营一部": "运营部", "运营二部": "运营部",
  "营销中心-直属": "运营部", "计划物流中心": "仓储物流部",
  "未分配部门": "未分配",
};

/** 部门 → 中心归属补全（无中心时兜底） */
export const DEPT_CENTER_FALLBACK: Record<string, string> = {
  "运营部": "营销中心",
  "经管部": "组织发展与赋能中心",
};

/** 用户级部门覆盖（飞书 open_id → 强制部门），优先级最高 */
export const USER_DEPT_OVERRIDE: Record<string, { department: string; center_name?: string }> = {
  "ou_6af5ecae880f5e73d8bb9cf11b765b0d": { department: "运营部", center_name: "营销中心" }, // 刘雨 → 运营部
};

/** 硬编码管理员（飞书 open_id），同步时不会被降级 */
export const HARDCODED_ADMIN_IDS = new Set([
  "ou_f2e284bb6701647e664c938806b08627", // 何广明
]);

/** 计算用户最终部门归属 */
export function computeDepartment(groupName: string | null, department: string): string {
  // 1. 组名映射优先
  if (groupName && GROUP_TO_DEPT[groupName]) return GROUP_TO_DEPT[groupName];
  // 2. 部门名修正
  if (department && DEPT_RENAME[department]) return DEPT_RENAME[department];
  // 3. 保留原名（如果有效）
  if (department && department !== "未分配部门") return department;
  // 4. 无归属
  return "未分配";
}
