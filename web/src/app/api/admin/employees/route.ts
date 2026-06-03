import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const dept = request.nextUrl.searchParams.get("department");
  const range = request.nextUrl.searchParams.get("range") || "month";
  const level = request.nextUrl.searchParams.get("level") || "department";
  const { sqlite } = await getDb();

  const now = new Date();
  let startTime: number;

  switch (range) {
    case "day":
      startTime = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
      break;
    case "week": {
      const dayOfWeek = now.getDay() || 7;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
      startTime = Math.floor(monday.getTime() / 1000);
      break;
    }
    case "year":
      startTime = Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
      break;
    case "month":
    default:
      startTime = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  }

  const dbAny = sqlite as any;

  // 动态检测列，兼容任何 schema 版本
  const colInfo = dbAny.exec(`PRAGMA table_info(users)`);
  const cols = new Set((colInfo[0]?.values ?? []).map((r: unknown[]) => String(r[1])));

  let deptCol = "u.department";
  if (level === "group" && cols.has("group_name")) {
    deptCol = "u.group_name";
  } else if (level === "center" && cols.has("center_name")) {
    deptCol = "u.center_name";
  } else if (!cols.has("department")) {
    // department 列不存在时，用 name 或空字符串兜底
    deptCol = "'未分配'";
  }

  let query = `
    SELECT u.name, ${deptCol} as dept_label, u.email, u.avatar,
      SUM(ul.total_tokens) as tokens, SUM(ul.cost) as cost, COUNT(*) as count
    FROM usage_logs ul
    JOIN users u ON ul.user_id = u.id
    WHERE ul.created_at >= ?`;
  const params: unknown[] = [startTime];

  if (dept && deptCol !== "'未分配'") {
    query += ` AND ${deptCol} = ?`;
    params.push(dept);
  }

  query += ` GROUP BY ul.user_id ORDER BY cost DESC LIMIT 20`;

  const result = dbAny.exec(query, params);

  const employees = (result[0]?.values ?? []).map((r: unknown[]) => ({
    name: String(r[0]),
    department: String(r[1] ?? "未分配"),
    email: String(r[2] ?? ""),
    avatar: String(r[3] ?? ""),
    tokens: Number(r[4]),
    cost: Number(r[5]),
    count: Number(r[6]),
  }));

  const deptListResult = dbAny.exec(
    `SELECT DISTINCT ${deptCol} FROM users WHERE ${deptCol} IS NOT NULL AND ${deptCol} != '' ORDER BY ${deptCol}`
  );
  const departments = (deptListResult[0]?.values ?? []).map((r: unknown[]) => String(r[0]));

  return NextResponse.json({ employees, departments, level });
}
