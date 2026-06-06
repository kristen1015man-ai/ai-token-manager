import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";
import { users } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";
import { auditLog } from "../../../../lib/audit-log";
import { apiHandler, apiHandlerNoBody } from "../../../../lib/api-handler";

const VALID_ROLES = ["admin", "finance", "dept_manager", "member"];

/** 解析逗号分隔的角色字符串 → 数组 */
function parseRoles(roleStr: string | null): string[] {
  if (!roleStr) return ["member"];
  const roles = roleStr.split(",").map((r) => r.trim()).filter((r) => VALID_ROLES.includes(r));
  return roles.length > 0 ? roles : ["member"];
}

/** 角色数组 → 逗号分隔字符串 */
function joinRoles(roles: string[]): string {
  if (roles.length === 0) return "member";
  return roles.join(",");
}

/** 获取所有用户及角色 */
export const GET = apiHandlerNoBody(async () => {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const list = await db
    .select({
      id: users.id,
      name: users.name,
      avatar: users.avatar,
      role: users.role,
      department: users.department,
      departmentId: users.departmentId,
      status: users.status,
      feishuId: users.feishuId,
    })
    .from(users)
    .orderBy(users.name);

  // 把逗号分隔的 role 转成数组
  const result = list.map((u) => ({
    ...u,
    roles: parseRoles(u.role),
  }));

  return NextResponse.json({ users: result });
});

/** 给用户添加一个角色 */
export const POST = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const { userId, role } = await request.json();
  if (!userId || !role) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "无效角色" }, { status: 400 });
  }

  const { db } = await getDb();
  const rows = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const currentRoles = parseRoles(rows[0].role);
  if (currentRoles.includes(role)) {
    return NextResponse.json({ success: true, message: "已有该角色" });
  }

  const newRoles = [...currentRoles, role];
  await db.update(users).set({ role: joinRoles(newRoles), updatedAt: new Date() }).where(eq(users.id, userId));
  await saveDb();

  await auditLog(session.userId, "update", "permission", userId, { action: "add_role", role, newRoles });
  return NextResponse.json({ success: true });
});

/** 从用户移除一个角色 */
export const DELETE = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const { userId, role } = await request.json();
  if (!userId || !role) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }

  const { db } = await getDb();
  const rows = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const currentRoles = parseRoles(rows[0].role);

  // 安全保护：移除 admin 时，确保至少还有一个 admin
  if (role === "admin") {
    const allUsers = await db.select({ id: users.id, role: users.role }).from(users);
    const adminCount = allUsers.filter((u) => parseRoles(u.role).includes("admin")).length;
    if (adminCount <= 1) {
      return NextResponse.json({ error: "至少需要保留一个管理员" }, { status: 400 });
    }
  }

  const newRoles = currentRoles.filter((r) => r !== role);
  await db.update(users).set({ role: joinRoles(newRoles), updatedAt: new Date() }).where(eq(users.id, userId));
  await saveDb();

  await auditLog(session.userId, "update", "permission", userId, { action: "remove_role", role, newRoles });
  return NextResponse.json({ success: true });
});

/** 修改用户角色（兼容旧接口） */
export const PUT = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const { userId, role } = await request.json();
  if (!userId || !role) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "无效角色" }, { status: 400 });
  }

  const { db } = await getDb();

  // 安全保护：如果是把 admin 降级，确保还有一个 admin
  if (role !== "admin") {
    const targetRows = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
    if (targetRows.length > 0 && parseRoles(targetRows[0].role).includes("admin")) {
      const allUsers = await db.select({ id: users.id, role: users.role }).from(users);
      const adminCount = allUsers.filter((u) => parseRoles(u.role).includes("admin")).length;
      if (adminCount <= 1) {
        return NextResponse.json({ error: "至少需要保留一个管理员" }, { status: 400 });
      }
    }
  }

  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  await saveDb();

  await auditLog(session.userId, "update", "permission", userId, { action: "set_role", role });
  return NextResponse.json({ success: true });
});
