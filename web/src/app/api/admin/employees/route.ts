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

  // 动态检测表中有哪些列，做兼容
  const dbAny = sqlite as any;
  const colResult = dbAny.exec(`PRAGMA table_info(users)`);
  const existingCols = new Set(
    (colResult[0]?.values ?? []).map((r: unknown[]) => String(r[1]))
  );

  // 根据 level 选择聚合列（fallback 到 department）
  let deptCol: string;
  let deptIdCol: string;

  if (level === "group" && existingCols.has("group_name")) {
    deptCol = "u.group_name";
    deptIdCol = "u.group_id";
  } else if (level === "center" && existingCols.has("center_name")) {
    deptCol = "u.center_name";
    deptIdCol = "u.center_id";
  } else {
    deptCol = "u.department";
    deptIdCol = existingCols.has("department_id") ? "u.department_id" : "''";
  }

  let query = `
    SELECT u.name, ${deptCol} as dept_label, ${deptIdCol} as dept_id, u.email, u.avatar,
      SUM(ul.total_tokens) as tokens, SUM(ul.cost) as cost, COUNT(*) as count
    FROM usage_logs ul
    JOIN users u ON ul.user_id = u.id
    WHERE ul.created_at >= ?`;
  const params: unknown[] = [startTime];

  if (dept) {
    query += ` AND ${deptCol} = ?`;
    params.push(dept);
  }

  query += ` GROUP BY ul.user_id ORDER BY cost DESC LIMIT 20`;

  const result = dbAny.exec(query, params);

  const employees = (result[0]?.values ?? []).map((r: unknown[]) => ({
    name: String(r[0]),
    department: String(r[1] ?? "未分配"),
    departmentId: String(r[2] ?? ""),
    email: String(r[3] ?? ""),
    avatar: String(r[4] ?? ""),
    tokens: Number(r[5]),
    cost: Number(r[6]),
    count: Number(r[7]),
  }));

  const deptListResult = dbAny.exec(
    `SELECT DISTINCT ${deptCol} FROM users WHERE ${deptCol} IS NOT NULL AND ${deptCol} != '' ORDER BY ${deptCol}`
  );
  const departments = (deptListResult[0]?.values ?? []).map((r: unknown[]) => String(r[0]));

  return NextResponse.json({ employees, departments, level });
}
