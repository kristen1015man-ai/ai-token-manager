import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";
import { users } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";

/** 获取所有用户及角色 */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const list = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      department: users.department,
      departmentId: users.departmentId,
      status: users.status,
      feishuId: users.feishuId,
    })
    .from(users)
    .orderBy(users.role, users.name);

  return NextResponse.json({ users: list });
}

/** 修改用户角色 */
export async function PUT(request: NextRequest) {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const { userId, role } = await request.json();
  if (!userId || !role) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  if (!["admin", "dept_head", "member"].includes(role)) {
    return NextResponse.json({ error: "无效角色" }, { status: 400 });
  }

  const { db } = await getDb();
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  await saveDb();

  return NextResponse.json({ success: true });
}
