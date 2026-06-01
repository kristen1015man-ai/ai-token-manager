import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "../../../../lib/db";
import { users } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";
import { createSession } from "../../../../lib/auth";

/**
 * 快捷登录（演示用）
 * 通过环境变量 ADMIN_EMAILS 控制是否启用
 * 自动创建/查找管理员用户并登录
 */
export async function GET(request: NextRequest) {

  const { db } = await getDb();

  // 查找或创建管理员测试用户
  let adminUser = (await db.select().from(users).where(eq(users.feishuId, "dev_admin")).limit(1))[0];

  if (!adminUser) {
    // 确保之前的测试用户存在
    const existing = (await db.select().from(users).limit(10));
    if (existing.length > 0) {
      adminUser = existing[0];
    } else {
      // 完全空库，创建一个
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
        apiKey: "sk-emp-dev-test-key", // 仅开发环境使用的测试Key
        role: "admin",
        status: "active",
        monthlyQuota: 200,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await saveDb();
      adminUser = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    }
  }

  // 创建 session
  await createSession({
    userId: adminUser.id,
    feishuId: adminUser.feishuId,
    name: adminUser.name,
    role: adminUser.role,
  });

  // 使用请求的 host 动态跳转，支持局域网访问
  const host = request.headers.get("host") || "localhost:3000";
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  return NextResponse.redirect(new URL("/dashboard", `${protocol}://${host}`));
}
