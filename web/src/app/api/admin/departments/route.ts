import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { sqlite } = await getDb();
  const now = new Date();
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

  // 按部门汇总
  const depts = (sqlite as any).exec(
    `SELECT u.department, COUNT(DISTINCT u.id) as user_count,
       SUM(ul.total_tokens) as tokens, SUM(ul.cost) as cost
     FROM usage_logs ul
     JOIN users u ON ul.user_id = u.id
     WHERE ul.created_at >= ?
     GROUP BY u.department
     ORDER BY cost DESC`,
    [monthStart]
  );

  const departments = (depts[0]?.values ?? []).map((r: unknown[]) => ({
    department: String(r[0] ?? "未分配部门"),
    userCount: Number(r[1]),
    tokens: Number(r[2]),
    cost: Number(r[3]),
    avgCost: Number(r[1]) ? Number(Number(r[3]) / Number(r[1])).toFixed(2) : "0",
  }));

  return NextResponse.json({ departments });
}
