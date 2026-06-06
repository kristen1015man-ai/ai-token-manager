/**
 * 角色权限配置（支持多角色）
 *
 * users.role 存逗号分隔的多角色（如 "admin,finance"）
 * - admin:      全部页面，含设置
 * - finance:    全局概览 + 部门分账（只读，可导出）
 * - dept_manager: 本部门排行 + 员工排行 + 本部门分账（只读）
 * - member:     我的用量 + API Key
 *
 * 一个人可以同时属于多个角色组，取并集。
 */

export type Role = "admin" | "finance" | "dept_manager" | "member";

export interface RoleDefinition {
  label: string;
  description: string;
  color: string; // tailwind classes
}

/** 角色展示信息 */
export const ROLE_LABELS: Record<Role, RoleDefinition> = {
  admin: {
    label: "管理员",
    description: "全部权限，含系统设置",
    color: "bg-indigo-50 text-indigo-700",
  },
  finance: {
    label: "财务",
    description: "查看全局概览和部门分账",
    color: "bg-emerald-50 text-emerald-700",
  },
  dept_manager: {
    label: "部门负责人",
    description: "查看本部门排行和本部门分账",
    color: "bg-amber-50 text-amber-700",
  },
  member: {
    label: "普通员工",
    description: "查看个人用量和 API Key",
    color: "bg-gray-50 text-gray-600",
  },
};

/** 解析 role 字段（逗号分隔）→ 角色数组 */
export function parseRoles(roleStr: string): Role[] {
  if (!roleStr || roleStr === "member") return ["member"];
  const roles = roleStr.split(",").map((r) => r.trim() as Role).filter(Boolean);
  return roles.length > 0 ? roles : ["member"];
}

/** 菜单项 */
export interface MenuItem {
  label: string;
  href: string;
  icon: string;
  /** 哪些角色可以看到此页面 */
  roles: Role[];
  /** 是否为设置类页面（非管理员只读） */
  readOnly?: boolean;
}

/** 完整菜单定义 */
export const MENU_ITEMS: MenuItem[] = [
  // ===== 通用页面 =====
  { label: "我的用量", href: "/dashboard", icon: "chart", roles: ["admin", "finance", "dept_manager", "member"] },
  { label: "API Key", href: "/dashboard/key", icon: "key", roles: ["admin", "finance", "dept_manager", "member"] },

  // ===== 管理页面 =====
  { label: "全局概览", href: "/dashboard/admin", icon: "globe", roles: ["admin", "finance"] },
  { label: "部门排行", href: "/dashboard/admin/departments", icon: "building", roles: ["admin", "dept_manager"] },
  { label: "员工排行", href: "/dashboard/admin/employees", icon: "users", roles: ["admin", "dept_manager"] },
  { label: "部门分账", href: "/dashboard/admin/billing", icon: "receipt", roles: ["admin", "finance", "dept_manager"] },
  { label: "渠道管理", href: "/dashboard/admin/channels", icon: "route", roles: ["admin"] },
  { label: "模型价格", href: "/dashboard/admin/prices", icon: "pricetag", roles: ["admin"] },
  { label: "限额设置", href: "/dashboard/admin/quotas", icon: "shield", roles: ["admin"] },
  { label: "预警记录", href: "/dashboard/admin/alerts", icon: "bell", roles: ["admin"] },
  { label: "操作日志", href: "/dashboard/admin/logs", icon: "document", roles: ["admin"] },
  { label: "权限管理", href: "/dashboard/admin/permissions", icon: "lock", roles: ["admin"] },
];

/** 获取某个角色（逗号分隔）可见的菜单项（多角色取并集） */
export function getMenuForRole(roleStr: string): MenuItem[] {
  const roles = parseRoles(roleStr);
  const seen = new Set<string>();
  return MENU_ITEMS.filter((item) => {
    if (seen.has(item.href)) return false;
    if (roles.some((r) => item.roles.includes(r))) {
      seen.add(item.href);
      return true;
    }
    return false;
  });
}

/** 检查某个角色（逗号分隔）是否可以访问指定路径 */
export function canAccess(roleStr: string, href: string): boolean {
  const roles = parseRoles(roleStr);
  return MENU_ITEMS.some(
    (item) => roles.some((r) => item.roles.includes(r)) && (item.href === href || href.startsWith(item.href + "/"))
  );
}

/** 检查某个角色对指定路径是否为只读 */
export function isReadOnly(roleStr: string, href: string): boolean {
  const roles = parseRoles(roleStr);
  if (roles.includes("admin")) return false;
  const item = MENU_ITEMS.find((m) => m.href === href);
  return !!item && item.readOnly !== false;
}
