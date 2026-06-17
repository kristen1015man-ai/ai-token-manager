/**
 * leaderboard.ts — 排行榜生成与发送
 *
 * 1. generateLeaderboard() — 查询当月用量数据，生成个人 TOP 10 + 部门 TOP 5
 * 2. sendLeaderboard() — 读设置中的群组列表，发送飞书卡片，写 alert_logs
 */

import { getDb, saveDb } from "./db";
import { usageLogs, users, alertLogs, alertSettings } from "../../../shared/schema";
import { sendCardMessage } from "./feishu-bot";
import { safeErrorSummary } from "./safe-error";
import { BRAND_NAME } from "./brand";
import { eq, and, gte, sql } from "drizzle-orm";
import { randomBytes } from "crypto";

// ===== 排行榜数据生成 =====

interface RankRow {
  name: string;
  department: string;
  totalCost: number;
  callCount: number;
}

interface DeptRow {
  department: string;
  totalCost: number;
  callCount: number;
  userCount: number;
}

export interface LeaderboardData {
  monthLabel: string;
  totalCost: number;
  totalCalls: number;
  activeUsers: number;
  topUsers: RankRow[];
  topDepts: DeptRow[];
}

/**
 * 生成本月用量排行榜数据
 */
export async function generateLeaderboard(): Promise<LeaderboardData> {
  const { db } = await getDb();

  const now = new Date();
  const monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 查询每个活跃用户的本月用量
  const rows = await db
    .select({
      name: users.name,
      department: users.department,
      totalCost: sql<number>`COALESCE(SUM(${usageLogs.cost}), 0)`,
      callCount: sql<number>`COUNT(${usageLogs.id})`,
    })
    .from(users)
    .leftJoin(
      usageLogs,
      and(
        eq(usageLogs.userId, users.id),
        gte(usageLogs.createdAt, monthStart)
      )
    )
    .where(eq(users.status, "active"))
    .groupBy(users.id)
    .having(sql`COALESCE(SUM(${usageLogs.cost}), 0) > 0`);

  const totalCost = rows.reduce((s, r) => s + Number(r.totalCost), 0);
  const totalCalls = rows.reduce((s, r) => s + Number(r.callCount), 0);
  const activeUsers = rows.length;

  // 个人排行 TOP 10
  const sorted = [...rows].sort(
    (a, b) => Number(b.totalCost) - Number(a.totalCost)
  );
  const topUsers: RankRow[] = sorted.slice(0, 10).map((r) => ({
    name: r.name,
    department: r.department || "未知",
    totalCost: Number(r.totalCost),
    callCount: Number(r.callCount),
  }));

  // 部门排行 TOP 5
  const deptMap = new Map<string, { cost: number; calls: number; users: number }>();
  for (const r of rows) {
    const dept = r.department || "未知";
    const existing = deptMap.get(dept) || { cost: 0, calls: 0, users: 0 };
    existing.cost += Number(r.totalCost);
    existing.calls += Number(r.callCount);
    existing.users += 1;
    deptMap.set(dept, existing);
  }

  const topDepts: DeptRow[] = [...deptMap.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5)
    .map(([department, d]) => ({
      department,
      totalCost: d.cost,
      callCount: d.calls,
      userCount: d.users,
    }));

  return { monthLabel, totalCost, totalCalls, activeUsers, topUsers, topDepts };
}

// ===== 排行榜卡片构建 =====

export function buildLeaderboardCard(data: LeaderboardData) {
  const medals = ["🥇", "🥈", "🥉"];

  const rankLines = data.topUsers.map((r, i) => {
    const medal = i < 3 ? medals[i] : `**${i + 1}**`;
    return `${medal}  ${r.name}（${r.department}）— ¥${r.totalCost.toFixed(2)} / ${r.callCount}次`;
  });

  const deptLines = data.topDepts.map((d) => {
    return `📊 ${d.department} — ¥${d.totalCost.toFixed(2)}（${d.userCount}人）`;
  });

  return {
    title: `🏆 ${data.monthLabel} 员工 AI 用量排行榜`,
    template: "blue" as const,
    elements: [
      `📅 **统计周期**：${data.monthLabel}1日 ~ 至今\n💰 **总花费**：¥${data.totalCost.toFixed(2)}　📞 **总调用**：${data.totalCalls.toLocaleString()}次　👥 **活跃用户**：${data.activeUsers}人`,
      "---",
      "**🏅 个人排行 TOP 10**",
      ...rankLines,
      "---",
      "**🏢 部门排行 TOP 5**",
      ...deptLines,
      "---",
      `💡 数据由 **${BRAND_NAME}** 自动统计生成`,
    ],
  };
}

// ===== 排行榜发送 =====

/**
 * 发送排行榜到配置的群组
 * @returns 发送结果：每个群组的发送状态
 */
export async function sendLeaderboard(): Promise<{
  sent: number;
  failed: number;
  chatIds: string[];
}> {
  // 1. 检查排行榜开关和群组配置
  const settings = await loadLeaderboardSettings();
  if (!settings.enabled) {
    console.log("[Leaderboard] Skipped: leaderboard toggle off");
    return { sent: 0, failed: 0, chatIds: [] };
  }
  if (settings.chatIds.length === 0) {
    console.log("[Leaderboard] Skipped: no chat IDs configured");
    return { sent: 0, failed: 0, chatIds: [] };
  }

  // 2. 生成排行榜数据
  const data = await generateLeaderboard();
  if (data.activeUsers === 0) {
    console.log("[Leaderboard] Skipped: no usage data this month");
    return { sent: 0, failed: 0, chatIds: settings.chatIds };
  }

  // 3. 构建卡片
  const card = buildLeaderboardCard(data);

  // 4. 发送到每个群组
  let sent = 0;
  let failed = 0;
  for (const chatId of settings.chatIds) {
    try {
      await sendCardMessage(chatId, "chat_id", card);
      sent++;
      console.log(`[Leaderboard] Sent to group ${chatId}`);
    } catch (err) {
      failed++;
      console.error(`[Leaderboard] Failed to send to ${chatId}:`, safeErrorSummary(err));
    }
  }

  // 5. 写 alert_logs
  try {
    const { db } = await getDb();
    await db.insert(alertLogs).values({
      id: randomBytes(8).toString("hex"),
      type: "leaderboard",
      targetId: settings.chatIds.join(","),
      message: `排行榜已发送到 ${sent} 个群组，活跃用户 ${data.activeUsers} 人，总花费 ¥${data.totalCost.toFixed(2)}`,
      sentAt: new Date(),
    });
    await saveDb();
  } catch (err) {
    console.error("[Leaderboard] Failed to log:", err);
  }

  return { sent, failed, chatIds: settings.chatIds };
}

// ===== 设置读取 =====

interface LeaderboardSettings {
  enabled: boolean;
  chatIds: string[];
  schedule: "disabled" | "weekly" | "monthly";
  sendDay: number;
}

async function loadLeaderboardSettings(): Promise<LeaderboardSettings> {
  const { db } = await getDb();
  const rows = await db.select().from(alertSettings);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.key, row.value);
  }

  const get = (key: string, fallback: string) => map.get(key) || fallback;

  let chatIds: string[] = [];
  try {
    chatIds = JSON.parse(get("leaderboard_chat_ids", "[]"));
  } catch {
    chatIds = [];
  }

  return {
    enabled: get("leaderboard_enabled", "false") === "true",
    chatIds,
    schedule: (get("leaderboard_schedule", "disabled") as LeaderboardSettings["schedule"]),
    sendDay: parseInt(get("leaderboard_send_day", "1"), 10) || 1,
  };
}

/**
 * 检查今天是否应该发送排行榜
 * 用于定时任务调度器判断
 */
export async function shouldSendLeaderboardToday(): Promise<boolean> {
  const settings = await loadLeaderboardSettings();
  if (!settings.enabled || settings.schedule === "disabled") return false;

  const now = new Date();
  const dayOfMonth = now.getDate();

  if (settings.schedule === "monthly") {
    return dayOfMonth === settings.sendDay;
  }

  if (settings.schedule === "weekly") {
    // 每周发送：sendDay 当作星期几（1=周一，7=周日）
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    return dayOfWeek === settings.sendDay;
  }

  return false;
}
