import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";

/**
 * 确保表有所需的列，没有就加（解决多实例缓存问题）
 */
function ensureColumns(dbAny: any) {
  const needed = [
    ["department", "TEXT"],
    ["department_id", "TEXT"],
    ["group_name", "TEXT"],
    ["group_id", "TEXT"],
    ["center_name", "TEXT"],
    ["center_id", "TEXT"],
  ];
  const colInfo = dbAny.exec(`PRAGMA table_info(users)`);
  const existing = new Set((colInfo[0]?.values ?? []).map((r: unknown[]) => String(r[1])));
  let changed = false;
  for (const [col, type] of needed) {
    if (!existing.has(col)) {
      try {
        dbAny.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
        changed = true;
      } catch { /* duplicate column, ignore */ }
    }
  }
  return changed;
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const dept = request.nextUrl.searchParams.get("department");
  const range = request.nextUrl.searchParams.get("range") || "month";
  const level = request.nextUrl.searchParams.get("level") || "department";
  const { sqlite } = await getDb();
  const dbAny = sqlite as any;

  // 确保 schema 正确
  if (ensureColumns(dbAny)) {
    await saveDb();
  }

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

  // 动态选列
  const colInfo = dbAny.exec(`PRAGMA table_info(users)`);
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

  let query = `
    SELECT u.name, ${deptCol} as dept_label, u.email, u.avatar,
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
    email: String(r[2] ?? ""),
    avatar: String(r[3] ?? ""),
    tokens: Number(r[4]),
    cost: Number(r[5]),
    count: Number(r[6]),
  }));

  // bareCol 不带表别名，用于直接查 users 表的场景
  const deptListResult = dbAny.exec(
    `SELECT DISTINCT ${bareCol} FROM users WHERE ${bareCol} IS NOT NULL AND ${bareCol} != '' ORDER BY ${bareCol}`
  );
  const departments = (deptListResult[0]?.values ?? []).map((r: unknown[]) => String(r[0]));

  return NextResponse.json({ employees, departments, level });
}
