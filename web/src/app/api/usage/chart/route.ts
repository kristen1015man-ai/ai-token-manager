import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import initSqlJs from "sql.js";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const granularity = request.nextUrl.searchParams.get("granularity") || "hourly";
  const { sqlite } = await getDb();
  const now = new Date();

  let startDate: Date;
  let groupFormat: string;

  switch (granularity) {
    case "daily":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      groupFormat = "%Y-%m-%d";
      break;
    case "weekly":
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      groupFormat = "%Y-W%W";
      break;
    case "monthly":
      startDate = new Date(now.getFullYear(), 0, 1);
      groupFormat = "%Y-%m";
      break;
    default: // hourly
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      groupFormat = "%H:00";
      break;
  }

  const startTs = Math.floor(startDate.getTime() / 1000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = sqlite as any;
  const result: { columns: string[]; values: unknown[][] }[] = dbAny.exec(
    `SELECT
      strftime('${groupFormat}', created_at, 'unixepoch', 'localtime') as time_slot,
      SUM(total_tokens) as tokens,
      SUM(cost) as cost
    FROM usage_logs
    WHERE user_id = ? AND created_at >= ?
    GROUP BY time_slot
    ORDER BY time_slot`,
    [session.userId, startTs]
  );

  const data = result[0]
    ? result[0].values.map((row: unknown[]) => ({
        time: String(row[0]),
        tokens: Number(row[1]) || 0,
        cost: Number(Number(row[2]).toFixed(4)),
      }))
    : [];

  return NextResponse.json({ granularity, data });
}
