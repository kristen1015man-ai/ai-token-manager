import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { sqlite } = await getDb();
  const now = new Date();
  const todayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

  // 今日统计
  const today = (sqlite as any).exec(
    `SELECT COALESCE(SUM(total_tokens),0) as tokens, COALESCE(SUM(cost),0) as cost, COUNT(*) as count
     FROM usage_logs WHERE created_at >= ?`,
    [todayStart]
  );

  // 本月统计
  const month = (sqlite as any).exec(
    `SELECT COALESCE(SUM(total_tokens),0) as tokens, COALESCE(SUM(cost),0) as cost, COUNT(*) as count
     FROM usage_logs WHERE created_at >= ?`,
    [monthStart]
  );

  // 活跃用户数（本月有记录的用户）
  const active = (sqlite as any).exec(
    `SELECT COUNT(DISTINCT user_id) as count FROM usage_logs WHERE created_at >= ?`,
    [monthStart]
  );

  // 本月每日趋势
  const trend = (sqlite as any).exec(
    `SELECT strftime('%Y-%m-%d', created_at, 'unixepoch', 'localtime') as day,
       SUM(total_tokens) as tokens, SUM(cost) as cost
     FROM usage_logs WHERE created_at >= ?
     GROUP BY day ORDER BY day`,
    [monthStart]
  );

  return NextResponse.json({
    today: {
      tokens: Number(today[0]?.values[0]?.[0] ?? 0),
      cost: Number(today[0]?.values[0]?.[1] ?? 0),
      count: Number(today[0]?.values[0]?.[2] ?? 0),
    },
    month: {
      tokens: Number(month[0]?.values[0]?.[0] ?? 0),
      cost: Number(month[0]?.values[0]?.[1] ?? 0),
      count: Number(month[0]?.values[0]?.[2] ?? 0),
    },
    activeUsers: Number(active[0]?.values[0]?.[0] ?? 0),
    trend: (trend[0]?.values ?? []).map((r: unknown[]) => ({
      day: String(r[0]),
      tokens: Number(r[1]),
      cost: Number(r[2]),
    })),
  });
}
