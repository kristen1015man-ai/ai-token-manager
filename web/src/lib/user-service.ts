import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { users } from "../../../shared/schema";
import { getDb, saveDb } from "./db";

/**
 * 生成 API Key: sk-emp-{随机16位十六进制}
 */
function generateApiKey(): string {
  return `sk-emp-${randomBytes(8).toString("hex")}`;
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
}) {
  const { db } = await getDb();
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim());

  // 查找现有用户
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.feishuId, feishuUserInfo.open_id))
    .limit(1);

  if (existing.length > 0) {
    // 更新用户信息
    await db
      .update(users)
      .set({
        name: feishuUserInfo.name || existing[0].name,
        avatar: feishuUserInfo.avatar_url || existing[0].avatar,
        email: feishuUserInfo.email || existing[0].email,
        employeeId: feishuUserInfo.employee_no || existing[0].employeeId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id));

    await saveDb();
    return existing[0];
  }

  // 创建新用户
  const userId = randomBytes(8).toString("hex");
  const apiKey = generateApiKey();
  const email = feishuUserInfo.email || "";
  const role = adminEmails.includes(email) ? "admin" : "member";

  await db.insert(users).values({
    id: userId,
    feishuId: feishuUserInfo.open_id,
    name: feishuUserInfo.name || "未知用户",
    avatar: feishuUserInfo.avatar_url || null,
    email: email || null,
    department: null,
    departmentId: null,
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
