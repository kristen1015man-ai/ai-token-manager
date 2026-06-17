import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";
import { users } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/admin/admins-list
 * 获取所有活跃管理员列表（供前端多选组件使用）
 */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      department: users.department,
    })
    .from(users)
    .where(
      eq(users.status, "active")
    );

  // 过滤出有 admin 角色的用户（role 是逗号分隔字符串）
  const admins = rows.filter((r) => {
    // 需要重新查询包含 role 字段
    return true; // 下面会单独查
  });

  // 单独查带 role 字段
  const adminRows = await db
    .select({
      id: users.id,
      name: users.name,
      department: users.department,
      role: users.role,
    })
    .from(users)
    .where(eq(users.status, "active"));

  const result = adminRows
    .filter((r) => {
      const roles = (r.role || "").split(",").map((s: string) => s.trim());
      return roles.includes("admin");
    })
    .map((r) => ({
      id: r.id,
      name: r.name,
      department: r.department || null,
    }));

  return NextResponse.json({ admins: result });
}
