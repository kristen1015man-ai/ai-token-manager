import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getDb, getRawExec } from "../../../../lib/db";
import { getTimeRange } from "../../../../lib/time-range";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = request.nextUrl.searchParams.get("range") || "day";
  const { start, end, label } = getTimeRange(range);

  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  const now = new Date();

  // 按时间范围统计
  let where = `user_id = ? AND created_at >= ?`;
  const params: unknown[] = [session.userId, start];
  if (end) {
    where += ` AND created_at < ?`;
    params.push(end);
  }

  const rangeStats = db.exec(
    `SELECT COALESCE(SUM(total_tokens), 0), COALESCE(SUM(cost), 0), COUNT(*)
     FROM usage_logs WHERE ${where}`,
    params
  );

  // 本月额度（始终取当月）
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  const monthStats = db.exec(
    `SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE user_id = ? AND created_at >= ?`,
    [session.userId, monthStart]
  );
  const monthCost = Number(monthStats[0]?.values[0]?.[0] ?? 0);

  // 用户配额
  const userInfo = db.exec(
    `SELECT COALESCE(monthly_quota, 500) FROM users WHERE id = ?`,
    [session.userId]
  );
  const monthlyQuota = Number(userInfo[0]?.values[0]?.[0] ?? 500);

  return NextResponse.json({
    tokens: Number(rangeStats[0]?.values[0]?.[0] ?? 0),
    cost: Number(rangeStats[0]?.values[0]?.[1] ?? 0),
    count: Number(rangeStats[0]?.values[0]?.[2] ?? 0),
    rangeLabel: label,
    monthlyQuota,
    quotaUsed: monthCost,
    quotaRemaining: Math.max(0, monthlyQuota - monthCost),
  });
}
