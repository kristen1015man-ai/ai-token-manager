import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { getTimeRange } from "../../../../lib/time-range";

/**
 * GET /api/usage/by-model?range=30d
 * 当前用户按模型汇总用量
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = request.nextUrl.searchParams.get("range") || "30d";
  const { start, end } = getTimeRange(range);

  const { sqlite } = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = sqlite as any;

  let where = `user_id = ? AND created_at >= ?`;
  const params: unknown[] = [session.userId, start];
  if (end) {
    where += ` AND created_at < ?`;
    params.push(end);
  }

  const result = dbAny.exec(
    `SELECT model,
       COALESCE(SUM(total_tokens), 0) as tokens,
       COALESCE(SUM(cost), 0) as cost,
       COUNT(*) as count
     FROM usage_logs
     WHERE ${where}
     GROUP BY model
     ORDER BY cost DESC`,
    params
  );

  const models = result[0]
    ? result[0].values.map((row: unknown[]) => ({
        model: String(row[0]),
        tokens: Number(row[1]),
        cost: Number(Number(row[2]).toFixed(4)),
        count: Number(row[3]),
      }))
    : [];

  return NextResponse.json({ models });
}
