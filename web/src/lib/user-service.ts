import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { users } from "../../../shared/schema";
import { getDb, saveDb } from "./db";

/**
 * 生成 API Key: sk-emp-{邮箱前缀或名字缩写}-{随机6位}
 * 例如: sk-emp-gmhe-x7k9m2
 */
export function generateApiKey(identifier?: string): string {
  const prefix = identifier
    ? identifier.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)
    : "user";
  const random = randomBytes(3).toString("hex");
  return `sk-emp-${prefix}-${random}`;
}

/**
 * 根据飞书 ID 查找或创建用户
 * 如果用户存在则更新信息，不存在则创建
 */
export async function findOrCreateUser(feishuUserInfo: {
  open_id: string;
  name?: string;
  avatar_url?: string;
  email?: string;
  employee_no?: string;
  department_id?: string;
  department_name?: string;
}) {
  const { db } = await getDb();
  // 管理员通过飞书 open_id 识别（不依赖邮箱）
  const adminIds = (process.env.ADMIN_IDS || "")
    .split(",")
    .map((e) => e.trim());

  // 查找现有用户
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.feishuId, feishuUserInfo.open_id))
    .limit(1);

  if (existing.length > 0) {
    // 每次登录都检查是否应该升级为管理员
    const shouldBeAdmin = adminIds.includes(feishuUserInfo.open_id);

    // 更新用户信息（包括角色和部门）
    await db
      .update(users)
      .set({
        name: feishuUserInfo.name || existing[0].name,
        avatar: feishuUserInfo.avatar_url || existing[0].avatar,
        email: email || existing[0].email,
        employeeId: feishuUserInfo.employee_no || existing[0].employeeId,
        department: feishuUserInfo.department_name || existing[0].department,
        departmentId: feishuUserInfo.department_id || existing[0].departmentId,
        role: shouldBeAdmin ? "admin" : existing[0].role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id));

    await saveDb();

    // 返回更新后的用户信息
    const updated = await db
      .select()
      .from(users)
      .where(eq(users.id, existing[0].id))
      .limit(1);
    return updated[0] || existing[0];
  }

  // 创建新用户
  const userId = randomBytes(8).toString("hex");
  const email = feishuUserInfo.email || "";
  const emailPrefix = email ? email.split("@")[0] : undefined;
  const apiKey = generateApiKey(emailPrefix);
  const role = adminIds.includes(feishuUserInfo.open_id) ? "admin" : "member";

  await db.insert(users).values({
    id: userId,
    feishuId: feishuUserInfo.open_id,
    name: feishuUserInfo.name || "未知用户",
    avatar: feishuUserInfo.avatar_url || null,
    email: email || null,
    department: feishuUserInfo.department_name || null,
    departmentId: feishuUserInfo.department_id || null,
    employeeId: feishuUserInfo.employee_no || null,
    apiKey,
    role,
    status: "active",
    monthlyQuota: 200,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await saveDb();

  const created = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return created[0];
}

/**
 * 根据 API Key 查找用户
 */
export async function findUserByApiKey(apiKey: string) {
  const { db } = await getDb();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.apiKey, apiKey))
    .limit(1);
  return result[0] || null;
}

/**
 * 根据 ID 查找用户
 */
export async function findUserById(userId: string) {
  const { db } = await getDb();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result[0] || null;
}
