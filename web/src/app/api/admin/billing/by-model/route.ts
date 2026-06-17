import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "../../../../../lib/admin-check";
import { parseRoles } from "../../../../../lib/permissions";
import { getDb, getRawExec } from "../../../../../lib/db";
import { getTimeRange } from "../../../../../lib/time-range";

/**
 * GET /api/admin/billing/by-model?range=30d
 * 管理端按模型汇总用量
 */
export async function GET(request: NextRequest) {
  const { session, error } = await requireRole("admin", "finance", "dept_manager");
  if (error) return error;
  const roles = parseRoles(session.role);
  const isDeptManagerOnly = roles.includes("dept_manager") && !roles.includes("admin") && !roles.includes("finance");

  const range = request.nextUrl.searchParams.get("range") || "30d";
  const { start, end } = getTimeRange(range);

  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);

  let where = `ul.created_at >= ?`;
  const params: unknown[] = [start];
  if (end) {
    where += ` AND ul.created_at < ?`;
    params.push(end);
  }
  if (isDeptManagerOnly) {
    if (!session.departmentId) {
      return NextResponse.json({ models: [] });
    }
    where += ` AND u.department_id = ?`;
    params.push(session.departmentId);
  }

  const result = db.exec(
    `SELECT ul.model,
       COALESCE(SUM(ul.total_tokens), 0) as tokens,
       COALESCE(SUM(ul.cost), 0) as cost,
       COUNT(*) as count
     FROM usage_logs ul
     LEFT JOIN users u ON ul.user_id = u.id
     WHERE ${where}
     GROUP BY ul.model
     ORDER BY cost DESC`,
    params
  );

  const models = result[0]
    ? result[0].values.map((row: unknown[]) => ({
        model: String(row[0]),
        tokens: Number(row[1]),
        cost: Number(Number(row[2]).toFixed(4)),
        count: Number(row[3]),
      }))
    : [];

  return NextResponse.json({ models });
}
