/**
 * notification-router.ts — 统一通知路由
 *
 * 所有通知类型走此模块：
 * 1. 检查总开关 (feishu_notify_enabled)
 * 2. 检查类型开关 (feishu_notify_types)
 * 3. 解析接收人（个人 → 直接指定；管理类型 → 读 notify_recipients_{type}，空则回退全部管理员）
 * 4. App Bot SDK 发送
 * 5. 写 alert_logs
 */

import { getDb, saveDb } from "./db";
import { alertSettings, alertLogs, users } from "../../../shared/schema";
import { sendCardMessage } from "./feishu-bot";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { safeErrorSummary } from "./safe-error";
import { parseRoles } from "./permissions";

// ===== 类型定义 =====

export type AlertType =
  | "personal_80"
  | "personal_100"
  | "dept_80"
  | "company_90"
  | "anomaly"
  | "balance_low"
  | "employee_departed"
  | "leaderboard";

// 个人通知类型 — 直接发给用户
const PERSONAL_TYPES: AlertType[] = ["personal_80", "personal_100"];

// 管理员通知类型 — 需要从设置读接收人
const ADMIN_TYPES: AlertType[] = [
  "dept_80",
  "company_90",
  "anomaly",
  "balance_low",
  "employee_departed",
];

export interface NotifyParams {
  type: AlertType;
  targetId: string;
  message: string;
  card?: {
    title: string;
    template?: "red" | "orange" | "blue" | "green";
    elements: string[];
  };
  /** 个人通知时直接指定接收人 feishuId */
  recipientFeishuId?: string;
  /** 强制发送，跳过总开关和类型开关，但仍使用接收人配置 */
  force?: boolean;
}

// ===== 读取设置 =====

async function loadSettings(): Promise<Map<string, string>> {
  const { db } = await getDb();
  const rows = await db.select().from(alertSettings);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.key, row.value);
  }
  return map;
}

function getSetting(map: Map<string, string>, key: string, fallback: string): string {
  return map.get(key) || fallback;
}

// ===== 解析接收人 =====

async function resolveRecipients(
  type: AlertType,
  settings: Map<string, string>,
  recipientFeishuId?: string
): Promise<string[]> {
  // 个人通知 — 直接用传入的 feishuId
  if (PERSONAL_TYPES.includes(type)) {
    if (recipientFeishuId) return [recipientFeishuId];
    return [];
  }

  // 管理员通知 — 读设置中的接收人列表
  const settingKey = `notify_recipients_${type}`;
  const jsonStr = getSetting(settings, settingKey, "[]");
  let userIds: string[] = [];
  try {
    userIds = JSON.parse(jsonStr);
  } catch {
    userIds = [];
  }

  // 如果指定了接收人，解析为 feishuId
  if (userIds.length > 0) {
    const { db } = await getDb();
    const feishuIdMap = new Map<string, string>();
    // 需要拿到 id -> feishuId 的映射
    const allUsers = await db
      .select({ id: users.id, feishuId: users.feishuId })
      .from(users)
      .where(eq(users.status, "active"));
    for (const u of allUsers) {
      feishuIdMap.set(u.id, u.feishuId);
    }
    return userIds
      .map((id) => feishuIdMap.get(id))
      .filter((fid): fid is string => !!fid);
  }

  // 空数组 → 回退到所有活跃管理员
  return getAllAdminFeishuIds();
}

async function getAllAdminFeishuIds(): Promise<string[]> {
  const { db } = await getDb();
  const rows = await db
    .select({ feishuId: users.feishuId, role: users.role })
    .from(users)
    .where(eq(users.status, "active"));
  return rows
    .filter((r) => parseRoles(r.role).includes("admin"))
    .map((r) => r.feishuId)
    .filter(Boolean);
}

// ===== 写入 alert_logs =====

async function logAlert(type: AlertType, targetId: string, message: string): Promise<void> {
  try {
    const { db } = await getDb();
    await db.insert(alertLogs).values({
      id: randomBytes(8).toString("hex"),
      type,
      targetId,
      message: message.slice(0, 1000), // 限制长度
      sentAt: new Date(),
    });
    await saveDb();
  } catch (err) {
    console.error("[NotificationRouter] Failed to log alert:", err);
  }
}

// ===== 核心函数 =====

/**
 * 统一通知入口
 *
 * @returns sent: 成功发送数, skipped: 跳过数
 */
export async function notifyAlert(params: NotifyParams): Promise<{ sent: number; skipped: number }> {
  const { type, targetId, message, card, recipientFeishuId, force } = params;

  // 1. 加载设置
  const settings = await loadSettings();

  // 2. 检查总开关
  const enabled = getSetting(settings, "feishu_notify_enabled", "false");
  if (!force && enabled !== "true") {
    console.log(`[NotificationRouter] Skipped: master toggle off (type=${type})`);
    return { sent: 0, skipped: 1 };
  }

  // 3. 检查类型开关
  const notifyTypes = getSetting(settings, "feishu_notify_types", "").split(",");
  if (!force && !notifyTypes.includes(type)) {
    console.log(`[NotificationRouter] Skipped: type ${type} not enabled`);
    return { sent: 0, skipped: 1 };
  }

  // 4. 解析接收人
  const recipients = await resolveRecipients(type, settings, recipientFeishuId);
  if (recipients.length === 0) {
    console.log(`[NotificationRouter] Skipped: no recipients for type=${type}`);
    return { sent: 0, skipped: 1 };
  }

  // 5. 发送
  let sent = 0;
  for (const feishuId of recipients) {
    try {
      if (card) {
        await sendCardMessage(feishuId, "open_id", card);
      } else {
        // 无卡片时用消息文本
        const { sendPrivateMessage } = await import("./feishu-bot");
        await sendPrivateMessage(feishuId, message);
      }
      sent++;
    } catch (err) {
      console.error(`[NotificationRouter] Failed to send to ${feishuId}:`, safeErrorSummary(err));
    }
  }

  // 6. 记日志
  await logAlert(type, targetId, message);

  console.log(`[NotificationRouter] Sent ${sent}/${recipients.length} for type=${type}`);
  return { sent, skipped: recipients.length - sent };
}

/**
 * 发送群组卡片（用于排行榜等场景）
 */
export async function notifyGroup(
  chatId: string,
  card: {
    title: string;
    template?: "red" | "orange" | "blue" | "green";
    elements: string[];
  },
  logType?: AlertType,
  logTargetId?: string,
  logMessage?: string
): Promise<{ sent: number }> {
  try {
    await sendCardMessage(chatId, "chat_id", card);
    if (logType) {
      await logAlert(logType, logTargetId || chatId, logMessage || card.title);
    }
    return { sent: 1 };
  } catch (err) {
    console.error(`[NotificationRouter] Failed to send to group ${chatId}:`, safeErrorSummary(err));
    return { sent: 0 };
  }
}

/**
 * 获取所有管理员列表（供 UI 多选组件用）
 */
export async function getAdminListForSelect(): Promise<
  Array<{ id: string; name: string; feishuId: string; department: string | null }>
> {
  const { db } = await getDb();
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      feishuId: users.feishuId,
      department: users.department,
      role: users.role,
    })
    .from(users)
    .where(eq(users.status, "active"));
  return rows
    .filter((row) => parseRoles(row.role).includes("admin"))
    .map(({ role, ...row }) => row);
}
