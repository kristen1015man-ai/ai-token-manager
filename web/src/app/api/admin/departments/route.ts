import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const level = request.nextUrl.searchParams.get("level") || "department";
  const { sqlite } = await getDb();
  const dbAny = sqlite as any;
  const now = new Date();
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

  // 动态检测列
  const colInfo = dbAny.exec(`PRAGMA table_info(users)`);
  const cols = new Set((colInfo[0]?.values ?? []).map((r: unknown[]) => String(r[1])));

  let deptCol = "u.department";
  if (level === "group" && cols.has("group_name")) {
    deptCol = "u.group_name";
  } else if (level === "center" && cols.has("center_name")) {
    deptCol = "u.center_name";
  } else if (!cols.has("department")) {
    deptCol = "'未分配'";
  }

  const depts = dbAny.exec(
    `SELECT ${deptCol} as dept_label,
       COUNT(DISTINCT u.id) as user_count,
       SUM(ul.total_tokens) as tokens,
       SUM(ul.cost) as cost
     FROM usage_logs ul
     JOIN users u ON ul.user_id = u.id
     WHERE ul.created_at >= ?
     GROUP BY ${deptCol}
     ORDER BY cost DESC`,
    [monthStart]
  );

  const departments = (depts[0]?.values ?? []).map((r: unknown[]) => ({
    department: String(r[0] ?? "未分配"),
    userCount: Number(r[1]),
    tokens: Number(r[2]),
    cost: Number(r[3]),
    avgCost: Number(r[1]) ? Number(Number(r[3]) / Number(r[1])).toFixed(2) : "0",
  }));

  return NextResponse.json({ departments, level });
}
