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
  const adminRows = await db
    .select({
      id: users.id,
      name: users.name,
      avatar: users.avatar,
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
      avatar: r.avatar || null,
      department: r.department || null,
    }));

  return NextResponse.json({ admins: result });
}
