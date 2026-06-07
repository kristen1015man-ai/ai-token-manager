import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "../../../../lib/admin-check";
import { getDb, getRawExec } from "../../../../lib/db";
import { getTimeRange } from "../../../../lib/time-range";

export async function GET(request: NextRequest) {
  const { error } = await requireRole("admin", "dept_manager");
  if (error) return error;

  const dept = request.nextUrl.searchParams.get("department");
  const range = request.nextUrl.searchParams.get("range") || "30d";
  const level = request.nextUrl.searchParams.get("level") || "department";
  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);

  const { start: startTime, end: rangeEnd } = getTimeRange(range);

  // 动态选列
  const colInfo = db.exec(`PRAGMA table_info(users)`);
  const cols = new Set((colInfo[0]?.values ?? []).map((r: unknown[]) => String(r[1])));

  let deptCol = "u.department";
  let bareCol = "department";
  if (level === "group" && cols.has("group_name")) {
    deptCol = "u.group_name";
    bareCol = "group_name";
  } else if (level === "center" && cols.has("center_name")) {
    deptCol = "u.center_name";
    bareCol = "center_name";
  }

  // LEFT JOIN: 返回所有用户，没有 usage_logs 的显示 0
  let joinCond = `ul.user_id = u.id AND ul.created_at >= ?`;
  const params: unknown[] = [startTime];
  if (rangeEnd) {
    joinCond += ` AND ul.created_at < ?`;
    params.push(rangeEnd);
  }

  let query = `
    SELECT u.name, ${deptCol} as dept_label, u.email, u.avatar,
      COALESCE(SUM(ul.total_tokens), 0) as tokens,
      COALESCE(SUM(ul.cost), 0) as cost,
      COALESCE(COUNT(ul.id), 0) as count
    FROM users u
    LEFT JOIN usage_logs ul ON ${joinCond}`;

  if (dept) {
    // 部门筛选必须放 WHERE，不能放 JOIN ON（LEFT JOIN 会保留所有用户行）
    query += ` WHERE ${deptCol} = ?`;
    params.push(dept);
  }

  query += ` GROUP BY u.id ORDER BY cost DESC`;

  const result = db.exec(query, params);

  const employees = (result[0]?.values ?? []).map((r: unknown[]) => ({
    name: String(r[0]),
    department: String(r[1] ?? "未分配"),
    email: String(r[2] ?? ""),
    avatar: String(r[3] ?? ""),
    tokens: Number(r[4]),
    cost: Number(r[5]),
    count: Number(r[6]),
  }));

  // bareCol 不带表别名，用于直接查 users 表的场景
  // 虚拟部门黑名单
  const VIRTUAL_DEPTS = ["管理部"];
  const deptListResult = db.exec(
    `SELECT DISTINCT ${bareCol} FROM users WHERE ${bareCol} IS NOT NULL AND ${bareCol} != '' ORDER BY ${bareCol}`
  );
  const departments = (deptListResult[0]?.values ?? [])
    .map((r: unknown[]) => String(r[0]))
    .filter((d: string) => !VIRTUAL_DEPTS.includes(d));

  return NextResponse.json({ employees, departments, level });
}
