import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";
import { getTimeRange } from "../../../../lib/time-range";

function ensureColumns(dbAny: any) {
  const needed = [
    ["department", "TEXT"], ["department_id", "TEXT"],
    ["group_name", "TEXT"], ["group_id", "TEXT"],
    ["center_name", "TEXT"], ["center_id", "TEXT"],
  ];
  const colInfo = dbAny.exec(`PRAGMA table_info(users)`);
  const existing = new Set((colInfo[0]?.values ?? []).map((r: unknown[]) => String(r[1])));
  let changed = false;
  for (const [col, type] of needed) {
    if (!existing.has(col)) {
      try { dbAny.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`); changed = true; } catch {}
    }
  }
  return changed;
}

export async function GET(request: NextRequest) {
  const { error } = await requireRole("admin", "finance", "dept_manager");
  if (error) return error;

  const level = request.nextUrl.searchParams.get("level") || "department";
  const range = request.nextUrl.searchParams.get("range") || "30d";
  const { sqlite } = await getDb();
  const dbAny = sqlite as any;

  if (ensureColumns(dbAny)) {
    await saveDb();
  }

  const { start: startTime, end: rangeEnd } = getTimeRange(range);

  const colInfo = dbAny.exec(`PRAGMA table_info(users)`);
  const cols = new Set((colInfo[0]?.values ?? []).map((r: unknown[]) => String(r[1])));

  let deptCol = "u.department";
  if (level === "group" && cols.has("group_name")) {
    deptCol = "u.group_name";
  } else if (level === "center" && cols.has("center_name")) {
    deptCol = "u.center_name";
  }

  let joinCond = `ul.user_id = u.id AND ul.created_at >= ?`;
  const sqlParams: number[] = [startTime];
  if (rangeEnd) {
    joinCond += ` AND ul.created_at < ?`;
    sqlParams.push(rangeEnd);
  }

  const depts = dbAny.exec(
    `SELECT ${deptCol} as dept_label,
       COUNT(DISTINCT u.id) as user_count,
       COALESCE(SUM(ul.total_tokens), 0) as tokens,
       COALESCE(SUM(ul.cost), 0) as cost
     FROM users u
     LEFT JOIN usage_logs ul ON ${joinCond}
     GROUP BY ${deptCol}
     ORDER BY cost DESC`,
    sqlParams
  );

  // 虚拟部门黑名单（非真实业务部门，不出现在排行中）
  const VIRTUAL_DEPTS = ["管理部"];

  const departments = (depts[0]?.values ?? [])
    .map((r: unknown[]) => ({
      department: String(r[0] ?? "未分配"),
      userCount: Number(r[1]),
      tokens: Number(r[2]),
      cost: Number(r[3]),
      avgCost: Number(r[1]) ? Number(Number(r[3]) / Number(r[1])).toFixed(2) : "0",
    }))
    .filter((d: { department: string }) => !VIRTUAL_DEPTS.includes(d.department));

  return NextResponse.json({ departments, level });
}
