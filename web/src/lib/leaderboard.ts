import { and, eq, gte, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { alertLogs, alertSettings, usageLogs, users } from "../../../shared/schema";
import { getDb, saveDb } from "./db";
import { sendCardMessage } from "./feishu-bot";
import { safeErrorSummary } from "./safe-error";
import { BRAND_NAME } from "./brand";
import { beijingCurrentMonthLabel, getBeijingDateParts, beijingStartOfMonthUnix } from "./beijing-time";

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

export async function generateLeaderboard(): Promise<LeaderboardData> {
  const { db } = await getDb();
  const monthLabel = beijingCurrentMonthLabel();
  const monthStart = new Date(beijingStartOfMonthUnix() * 1000);

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

  const totalCost = rows.reduce((sum, row) => sum + Number(row.totalCost), 0);
  const totalCalls = rows.reduce((sum, row) => sum + Number(row.callCount), 0);
  const activeUsers = rows.length;

  const topUsers: RankRow[] = [...rows]
    .sort((a, b) => Number(b.totalCost) - Number(a.totalCost))
    .slice(0, 10)
    .map((row) => ({
      name: row.name,
      department: row.department || "未知",
      totalCost: Number(row.totalCost),
      callCount: Number(row.callCount),
    }));

  const deptMap = new Map<string, { cost: number; calls: number; users: number }>();
  for (const row of rows) {
    const dept = row.department || "未知";
    const existing = deptMap.get(dept) || { cost: 0, calls: 0, users: 0 };
    existing.cost += Number(row.totalCost);
    existing.calls += Number(row.callCount);
    existing.users += 1;
    deptMap.set(dept, existing);
  }

  const topDepts: DeptRow[] = [...deptMap.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5)
    .map(([department, item]) => ({
      department,
      totalCost: item.cost,
      callCount: item.calls,
      userCount: item.users,
    }));

  return { monthLabel, totalCost, totalCalls, activeUsers, topUsers, topDepts };
}

export function buildLeaderboardCard(data: LeaderboardData) {
  const medals = ["1.", "2.", "3."];
  const rankLines = data.topUsers.map((row, index) => {
    const rank = index < 3 ? medals[index] : `${index + 1}.`;
    return `${rank} ${row.name}（${row.department}）：¥${row.totalCost.toFixed(2)} / ${row.callCount} 次`;
  });

  const deptLines = data.topDepts.map((row) =>
    `${row.department}：¥${row.totalCost.toFixed(2)} / ${row.callCount} 次 / ${row.userCount} 人`
  );

  return {
    title: `${data.monthLabel} 员工 AI 用量排行榜`,
    template: "blue" as const,
    elements: [
      `统计周期：${data.monthLabel}1 日至今\n总花费：¥${data.totalCost.toFixed(2)}，总调用：${data.totalCalls.toLocaleString()} 次，活跃用户：${data.activeUsers} 人`,
      "---",
      "**个人排行 TOP 10**",
      ...rankLines,
      "---",
      "**部门排行 TOP 5**",
      ...deptLines,
      "---",
      `数据由 **${BRAND_NAME}** 自动统计生成`,
    ],
  };
}

export async function sendLeaderboard(options: { allowEmpty?: boolean } = {}): Promise<{
  sent: number;
  failed: number;
  chatIds: string[];
  skippedReason?: string;
}> {
  const settings = await loadLeaderboardSettings();
  if (!settings.enabled) {
    console.log("[Leaderboard] Skipped: leaderboard toggle off");
    return { sent: 0, failed: 0, chatIds: [], skippedReason: "disabled" };
  }
  if (settings.chatIds.length === 0) {
    console.log("[Leaderboard] Skipped: no chat IDs configured");
    return { sent: 0, failed: 0, chatIds: [], skippedReason: "no_chat_ids" };
  }

  const data = await generateLeaderboard();
  if (data.activeUsers === 0 && !options.allowEmpty) {
    console.log("[Leaderboard] Skipped: no usage data this month");
    return { sent: 0, failed: 0, chatIds: settings.chatIds, skippedReason: "no_usage_data" };
  }

  const card = buildLeaderboardCard(data);
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
  for (const row of rows) map.set(row.key, row.value);

  const get = (key: string, fallback: string) => map.get(key) || fallback;

  let chatIds: string[] = [];
  try {
    const parsed = JSON.parse(get("leaderboard_chat_ids", "[]"));
    chatIds = Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    chatIds = [];
  }

  return {
    enabled: get("leaderboard_enabled", "false") === "true",
    chatIds,
    schedule: get("leaderboard_schedule", "disabled") as LeaderboardSettings["schedule"],
    sendDay: parseInt(get("leaderboard_send_day", "1"), 10) || 1,
  };
}

export async function shouldSendLeaderboardToday(): Promise<boolean> {
  const settings = await loadLeaderboardSettings();
  if (!settings.enabled || settings.schedule === "disabled") return false;

  const parts = getBeijingDateParts();

  if (settings.schedule === "monthly") {
    return parts.day === settings.sendDay;
  }

  if (settings.schedule === "weekly") {
    const dayOfWeek = parts.weekday === 0 ? 7 : parts.weekday;
    return dayOfWeek === settings.sendDay;
  }

  return false;
}
