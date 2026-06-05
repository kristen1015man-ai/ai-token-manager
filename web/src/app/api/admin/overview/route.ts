import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";
import { getTimeRange } from "../../../../lib/time-range";

export async function GET(request: NextRequest) {
  const { error } = await requireRole("admin", "finance");
  if (error) return error;

  const range = request.nextUrl.searchParams.get("range") || "30d";
  const { sqlite } = await getDb();
  const dbAny = sqlite as any;

  const { start, end, label } = getTimeRange(range);

  // 构造 WHERE 条件
  let where = `created_at >= ?`;
  const params: number[] = [start];
  if (end) {
    where += ` AND created_at < ?`;
    params.push(end);
  }

  // 统计卡片数据
  const stats = dbAny.exec(
    `SELECT COALESCE(SUM(total_tokens),0), COALESCE(SUM(cost),0), COUNT(*), COUNT(DISTINCT user_id)
     FROM usage_logs WHERE ${where}`,
    params
  );

  // 趋势数据：今年用月粒度，其余用日粒度
  const periodExpr = range === "year"
    ? `strftime('%Y-%m', created_at, 'unixepoch', 'localtime')`
    : `strftime('%Y-%m-%d', created_at, 'unixepoch', 'localtime')`;

  const trend = dbAny.exec(
    `SELECT ${periodExpr} as period, SUM(total_tokens) as tokens, SUM(cost) as cost
     FROM usage_logs WHERE ${where}
     GROUP BY period ORDER BY period`,
    params
  );

  return NextResponse.json({
    cost: Number(stats[0]?.values[0]?.[1] ?? 0),
    tokens: Number(stats[0]?.values[0]?.[0] ?? 0),
    count: Number(stats[0]?.values[0]?.[2] ?? 0),
    activeUsers: Number(stats[0]?.values[0]?.[3] ?? 0),
    rangeLabel: label,
    trend: (trend[0]?.values ?? []).map((r: unknown[]) => ({
      day: String(r[0]),
      tokens: Number(r[1]),
      cost: Number(r[2]),
    })),
    range,
  });
}
