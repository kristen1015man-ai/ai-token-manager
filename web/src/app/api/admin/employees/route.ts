import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "../../../../lib/admin-check";
import { getDb, getRawExec } from "../../../../lib/db";
import { getTimeRange } from "../../../../lib/time-range";
import { parseRoles } from "../../../../lib/permissions";

export async function GET(request: NextRequest) {
  const { session, error } = await requireRole("admin", "dept_manager");
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

  // LEFT JOIN: 返回所有员工（包括无用量的）
  let joinCond = `ul.user_id = u.id AND ul.created_at >= ?`;
  const params: unknown[] = [startTime];
  if (rangeEnd) {
    joinCond += ` AND ul.created_at < ?`;
    params.push(rangeEnd);
  }
  const roles = parseRoles(session.role);
  const isDeptManagerOnly = roles.includes("dept_manager") && !roles.includes("admin");

  let query = `
    SELECT u.name, ${deptCol} as dept_label, u.email, u.avatar,
      COALESCE(SUM(ul.total_tokens), 0) as tokens,
      COALESCE(SUM(ul.cost), 0) as cost,
      COALESCE(COUNT(ul.id), 0) as count
    FROM users u
    LEFT JOIN usage_logs ul ON ${joinCond}`;

  // 只返回活跃用户（过滤已禁用的旧 seed 数据）
  if (isDeptManagerOnly) {
    if (!session.departmentId) {
      return NextResponse.json({ employees: [], departments: [], level });
    }
    query += ` WHERE u.status = 'active' AND u.department_id = ?`;
    params.push(session.departmentId);
  } else if (dept) {
    query += ` WHERE u.status = 'active' AND ${deptCol} = ?`;
    params.push(dept);
  } else {
    query += ` WHERE u.status = 'active'`;
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

  // 部门下拉列表（排除虚拟部门和"未分配"）
  const VIRTUAL_DEPTS = ["管理部", "未分配"];
  const deptListResult = isDeptManagerOnly && session.departmentId
    ? db.exec(
        `SELECT DISTINCT ${bareCol} FROM users WHERE status = 'active' AND department_id = ? AND ${bareCol} IS NOT NULL AND ${bareCol} != '' ORDER BY ${bareCol}`,
        [session.departmentId]
      )
    : db.exec(
        `SELECT DISTINCT ${bareCol} FROM users WHERE status = 'active' AND ${bareCol} IS NOT NULL AND ${bareCol} != '' ORDER BY ${bareCol}`
      );
  const departments = (deptListResult[0]?.values ?? [])
    .map((r: unknown[]) => String(r[0]))
    .filter((d: string) => !VIRTUAL_DEPTS.includes(d));

  return NextResponse.json({ employees, departments, level });
}
