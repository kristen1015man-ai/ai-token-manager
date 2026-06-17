import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, type SqliteExec } from "../../../../lib/db";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { sqlite } = await getDb();
  const now = new Date();
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

  const result = (sqlite as unknown as SqliteExec).exec(
    `SELECT model,
       SUM(total_tokens) as tokens, SUM(cost) as cost, COUNT(*) as count
     FROM usage_logs WHERE created_at >= ?
     GROUP BY model ORDER BY cost DESC`,
    [monthStart]
  );

  const models = (result[0]?.values ?? []).map((r: unknown[]) => ({
    model: String(r[0]),
    tokens: Number(r[1]),
    cost: Number(r[2]),
    count: Number(r[3]),
  }));

  return NextResponse.json({ models });
}
