import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  // level: "group" | "department" | "center" — 默认部门级
  const level = request.nextUrl.searchParams.get("level") || "department";
  const { sqlite } = await getDb();
  const now = new Date();
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

  // 根据 level 选择聚合列
  const deptCol = level === "group" ? "u.group_name"
    : level === "center" ? "u.center_name"
    : "u.department";

  // 按选定层级汇总：人数去重、费用和 token 聚合
  const depts = (sqlite as any).exec(
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
