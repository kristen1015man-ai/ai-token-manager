import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../lib/admin-check";
import { getDb, getRawExec } from "../../../../lib/db";
import { getBeijingMonthStartUnix, getTimeRange } from "../../../../lib/time-range";

export async function GET(request: NextRequest) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const range = request.nextUrl.searchParams.get("range") || "day";
  const { start, end, label } = getTimeRange(range);

  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);

  let where = "user_id = ? AND created_at >= ?";
  const params: unknown[] = [session.userId, start];
  if (end) {
    where += " AND created_at < ?";
    params.push(end);
  }

  const rangeStats = db.exec(
    `SELECT COALESCE(SUM(total_tokens), 0), COALESCE(SUM(cost), 0), COUNT(*)
     FROM usage_logs WHERE ${where}`,
    params
  );

  const monthStart = getBeijingMonthStartUnix();
  const monthStats = db.exec(
    "SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE user_id = ? AND created_at >= ?",
    [session.userId, monthStart]
  );
  const monthCost = Number(monthStats[0]?.values[0]?.[0] ?? 0);

  const userInfo = db.exec(
    "SELECT COALESCE(monthly_quota, 500) FROM users WHERE id = ?",
    [session.userId]
  );
  const monthlyQuota = Number(userInfo[0]?.values[0]?.[0] ?? 500);
  const quotaPercent = monthlyQuota > 0 ? (monthCost / monthlyQuota) * 100 : 0;

  return NextResponse.json({
    tokens: Number(rangeStats[0]?.values[0]?.[0] ?? 0),
    cost: Number(rangeStats[0]?.values[0]?.[1] ?? 0),
    count: Number(rangeStats[0]?.values[0]?.[2] ?? 0),
    rangeLabel: label,
    monthlyQuota,
    quotaUsed: monthCost,
    quotaRemaining: Math.max(0, monthlyQuota - monthCost),
    quotaPercent,
  });
}
