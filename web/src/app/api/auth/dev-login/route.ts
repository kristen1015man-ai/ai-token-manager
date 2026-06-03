import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "../../../../lib/db";
import { users } from "../../../../../../shared/schema";
import { eq, desc } from "drizzle-orm";
import { createSession } from "../../../../lib/auth";

/**
 * 快捷登录（演示用）
 * 优先找管理员账号登录，确保能看到所有数据
 */
export async function GET(request: NextRequest) {

  const { db } = await getDb();

  // 1. 优先找 admin 角色的用户
  let adminUser = (await db.select().from(users).where(eq(users.role, "admin")).limit(1))[0];

  // 2. 没有管理员则找 dev_admin 测试账号
  if (!adminUser) {
    adminUser = (await db.select().from(users).where(eq(users.feishuId, "dev_admin")).limit(1))[0];
  }

  // 3. 都没有则取第一个用户并升级为 admin
  if (!adminUser) {
    const existing = await db.select().from(users).limit(1);
    if (existing.length > 0) {
      await db.update(users).set({ role: "admin" }).where(eq(users.id, existing[0].id));
      await saveDb();
      adminUser = (await db.select().from(users).where(eq(users.id, existing[0].id)).limit(1))[0];
    }
  }

  // 4. 完全空库，创建管理员
  if (!adminUser) {
    const { randomBytes } = await import("crypto");
    const userId = randomBytes(8).toString("hex");
    await db.insert(users).values({
      id: userId,
      feishuId: "dev_admin",
      name: "开发管理员",
      avatar: null,
      email: "admin@yourcompany.com",
      department: "研发部",
      departmentId: "dept_dev",
      employeeId: "DEV001",
      apiKey: "sk-emp-dev-test-key",
      role: "admin",
      status: "active",
      monthlyQuota: 200,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await saveDb();
    adminUser = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  }

  // 创建 session
  await createSession({
    userId: adminUser.id,
    feishuId: adminUser.feishuId,
    name: adminUser.name,
    role: "admin", // dev-login 强制 admin
  });

  const host = request.headers.get("host") || "localhost:3000";
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  return NextResponse.redirect(new URL("/dashboard", `${protocol}://${host}`));
}
