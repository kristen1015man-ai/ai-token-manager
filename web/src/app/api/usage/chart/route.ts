import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { getTimeRange } from "../../../../lib/time-range";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = request.nextUrl.searchParams.get("range") || "day";
  const { start, end, label } = getTimeRange(range);

  // 粒度：今日/近7天 → 小时级，近30天/历史月份 → 日级，今年 → 月级
  let groupFormat: string;
  if (range === "day" || range === "7d") {
    groupFormat = "%Y-%m-%d %H:00";
  } else if (range === "year") {
    groupFormat = "%Y-%m";
  } else {
    // 30d 或历史月份(YYYY-MM) → 日级
    groupFormat = "%Y-%m-%d";
  }

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
    `SELECT
      strftime('${groupFormat}', created_at, 'unixepoch', 'localtime') as time_slot,
      SUM(total_tokens) as tokens,
      SUM(cost) as cost
    FROM usage_logs
    WHERE ${where}
    GROUP BY time_slot
    ORDER BY time_slot`,
    params
  );

  const data = result[0]
    ? result[0].values.map((row: unknown[]) => ({
        time: String(row[0]),
        tokens: Number(row[1]) || 0,
        cost: Number(Number(row[2]).toFixed(4)),
      }))
    : [];

  return NextResponse.json({ range, label, data });
}
