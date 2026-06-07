import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { getDb, getRawExec } from "../../../../../lib/db";
import { getTimeRange } from "../../../../../lib/time-range";

/**
 * GET /api/admin/billing/by-channel?range=30d
 * 管理端按渠道汇总用量
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const range = request.nextUrl.searchParams.get("range") || "30d";
  const { start, end } = getTimeRange(range);

  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);

  let where = `ul.created_at >= ?`;
  const params: unknown[] = [start];
  if (end) {
    where += ` AND ul.created_at < ?`;
    params.push(end);
  }

  const result = db.exec(
    `SELECT ul.channel_id,
       COALESCE(c.name, ul.channel_id) as channel_name,
       COALESCE(c.currency, 'CNY') as channel_currency,
       COALESCE(SUM(ul.total_tokens), 0) as tokens,
       COALESCE(SUM(ul.cost), 0) as cost,
       COUNT(*) as count
     FROM usage_logs ul
     LEFT JOIN channels c ON ul.channel_id = c.id
     WHERE ${where}
     GROUP BY ul.channel_id
     ORDER BY cost DESC`,
    params
  );

  const channels = result[0]
    ? result[0].values.map((row: unknown[]) => ({
        channelId: String(row[0]),
        channelName: String(row[1]),
        channelCurrency: String(row[2]),
        tokens: Number(row[3]),
        cost: Number(Number(row[4]).toFixed(4)),
        count: Number(row[5]),
      }))
    : [];

  return NextResponse.json({ channels });
}
