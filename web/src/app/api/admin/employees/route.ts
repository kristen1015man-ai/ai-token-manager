import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const dept = request.nextUrl.searchParams.get("department");
  const { sqlite } = await getDb();
  const now = new Date();
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

  let query = `
    SELECT u.name, u.department, u.email, u.avatar,
      SUM(ul.total_tokens) as tokens, SUM(ul.cost) as cost, COUNT(*) as count
    FROM usage_logs ul
    JOIN users u ON ul.user_id = u.id
    WHERE ul.created_at >= ?`;
  const params: unknown[] = [monthStart];

  if (dept) {
    query += ` AND u.department = ?`;
    params.push(dept);
  }

  query += ` GROUP BY ul.user_id ORDER BY cost DESC LIMIT 20`;

  const result = (sqlite as any).exec(query, params);

  const employees = (result[0]?.values ?? []).map((r: unknown[]) => ({
    name: String(r[0]),
    department: String(r[1] ?? "未分配"),
    email: String(r[2] ?? ""),
    avatar: String(r[3] ?? ""),
    tokens: Number(r[4]),
    cost: Number(r[5]),
    count: Number(r[6]),
  }));

  return NextResponse.json({ employees });
}
