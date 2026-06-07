import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { pinyin } from "pinyin-pro";
import { users } from "../../../shared/schema";
import { getDb, saveDb } from "./db";
import { ensureEncrypted, ensureDecrypted, safeEqual, searchableHash } from "./crypto";

/**
 * 中文名 → 拼音标识（无音调、小写、去空格）
 * "何广明" → "heguangming"，"Jean-Paul" → "jeanpaul"
 */
function nameToPinyin(name: string): string {
  if (!name) return "user";
  // 先尝试拼音转换（中文名会得到拼音数组）
  const py = pinyin(name, { toneType: "none", type: "array" });
  const joined = py.join("").toLowerCase().replace(/[^a-z0-9]/g, "");
  return joined.slice(0, 16) || "user";
}

/**
 * 生成 API Key: sk-{名字拼音}-{随机12位}
 * 示例: sk-heguangming-a1b2c3d4e5f6
 */
export function generateApiKey(name?: string): string {
  const prefix = nameToPinyin(name || "");
  const random = randomBytes(6).toString("hex");
  return `sk-${prefix}-${random}`;
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
  group_id?: string;
  group_name?: string;
  center_id?: string;
  center_name?: string;
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
    const shouldBeAdmin = adminIds.includes(feishuUserInfo.open_id);
    const current = existing[0];

    // 更新用户信息，但保留已有的三层数据（除非传入新值）
    const updateData: {
      name: string;
      avatar: string | null;
      email: string | null;
      employeeId: string | null;
      role: string;
      updatedAt: Date;
      department?: string | null;
      departmentId?: string | null;
      groupName?: string | null;
      groupId?: string | null;
      centerName?: string | null;
      centerId?: string | null;
    } = {
      name: feishuUserInfo.name || current.name,
      avatar: feishuUserInfo.avatar_url || current.avatar,
      email: feishuUserInfo.email || current.email,
      employeeId: feishuUserInfo.employee_no || current.employeeId,
      role: shouldBeAdmin ? "admin" : current.role,
      updatedAt: new Date(),
    };

    // 三层组织架构：只在有值时更新（避免登录时清空 sync-feishu 的数据）
    if (feishuUserInfo.department_name) {
      updateData.department = feishuUserInfo.department_name;
      updateData.departmentId = feishuUserInfo.department_id || current.departmentId;
    }
    if (feishuUserInfo.group_name) {
      updateData.groupName = feishuUserInfo.group_name;
      updateData.groupId = feishuUserInfo.group_id || null;
    }
    if (feishuUserInfo.center_name) {
      updateData.centerName = feishuUserInfo.center_name;
      updateData.centerId = feishuUserInfo.center_id || null;
    }

    await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, current.id));

    await saveDb();

    const updated = await db
      .select()
      .from(users)
      .where(eq(users.id, current.id))
      .limit(1);
    return updated[0] || current;
  }

  // 创建新用户
  const userId = randomBytes(8).toString("hex");
  const email = feishuUserInfo.email || "";
  const apiKey = generateApiKey(feishuUserInfo.name);
  const role = adminIds.includes(feishuUserInfo.open_id) ? "admin" : "member";

  await db.insert(users).values({
    id: userId,
    feishuId: feishuUserInfo.open_id,
    name: feishuUserInfo.name || "未知用户",
    avatar: feishuUserInfo.avatar_url || null,
    email: email || null,
    department: feishuUserInfo.department_name || null,
    departmentId: feishuUserInfo.department_id || null,
    groupName: feishuUserInfo.group_name || null,
    groupId: feishuUserInfo.group_id || null,
    centerName: feishuUserInfo.center_name || null,
    centerId: feishuUserInfo.center_id || null,
    employeeId: feishuUserInfo.employee_no || null,
    apiKey: ensureEncrypted(apiKey),
    apiKeyHash: searchableHash(apiKey),
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
 * SEC-02: 使用 HMAC-SHA256 hash 做 SQL WHERE 精确匹配，避免全表扫描
 * hash 为确定性映射，可用于索引查找；找到后仍做 safeEqual 二次验证
 */
export async function findUserByApiKey(apiKey: string) {
  const { db } = await getDb();
  const hash = searchableHash(apiKey);
  const candidates = await db
    .select()
    .from(users)
    .where(eq(users.apiKeyHash, hash))
    .limit(1);

  if (candidates.length === 0) return null;

  // 二次验证：hash 碰撞理论上可能，用 timing-safe 比对确认
  const user = candidates[0];
  const decryptedKey = ensureDecrypted(user.apiKey);
  if (safeEqual(decryptedKey, apiKey)) {
    return user;
  }
  return null;
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
