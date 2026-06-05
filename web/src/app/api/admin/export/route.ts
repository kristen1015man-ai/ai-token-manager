import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { getTimeRange } from "../../../../lib/time-range";
import * as XLSX from "xlsx";

/** 允许导出的角色 */
const EXPORT_ROLES = new Set(["admin", "finance", "dept_manager"]);

/**
 * 检查当前用户是否有导出权限
 */
async function requireExportRole() {
  const session = await getSession();
  if (!session) {
    return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!EXPORT_ROLES.has(session.role)) {
    return { session, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, error: null };
}

/**
 * 导出 Excel 报表（财务视角）
 *
 * 权限：管理员、财务、部门负责人均可导出
 *
 * - 只按时间段筛选
 * - 按员工汇总（不拆每条调用记录）
 * - 模型统一为 deepseek
 * - 不显示 token，只显示费用
 *
 * Sheet 1: 员工费用汇总（按部门+姓名排序）
 * Sheet 2: 部门费用汇总（排名、占比、人均）
 */
export async function GET(request: NextRequest) {
  const { error } = await requireExportRole();
  if (error) return error;

  const range = request.nextUrl.searchParams.get("range") || "30d";
  const { start, end, label } = getTimeRange(range);

  const { sqlite } = await getDb();
  const dbAny = sqlite as any;

  // 构建时间条件
  let timeWhere = `ul.created_at >= ?`;
  const params: number[] = [start];
  if (end) {
    timeWhere += ` AND ul.created_at < ?`;
    params.push(end);
  }

  // ===== Sheet 1: 员工费用汇总 =====
  const empResult = dbAny.exec(
    `SELECT u.name, u.department,
       COUNT(ul.id) as call_count,
       COALESCE(SUM(ul.cost), 0) as total_cost
     FROM users u
     LEFT JOIN usage_logs ul ON ul.user_id = u.id AND ${timeWhere}
     GROUP BY u.id
     HAVING total_cost > 0
     ORDER BY u.department, total_cost DESC`,
    params
  );

  const empRows = (empResult[0]?.values ?? []).map((r: unknown[]) => ({
    "员工姓名": String(r[0] ?? ""),
    "部门": String(r[1] ?? "未分配"),
    "调用次数": Number(r[2]),
    "费用(元)": Number(Number(r[3]).toFixed(2)),
  }));

  // ===== Sheet 2: 部门费用汇总 =====
  const deptParams = [...params];
  const deptResult = dbAny.exec(
    `SELECT u.department as dept,
       COUNT(DISTINCT u.id) as user_count,
       COUNT(ul.id) as call_count,
       COALESCE(SUM(ul.cost), 0) as total_cost
     FROM users u
     LEFT JOIN usage_logs ul ON ul.user_id = u.id AND ${timeWhere}
     GROUP BY u.department
     ORDER BY total_cost DESC`,
    deptParams
  );

  const totalCost = (deptResult[0]?.values ?? []).reduce(
    (sum: number, r: unknown[]) => sum + Number(r[3]), 0
  );

  const deptRows = (deptResult[0]?.values ?? []).map((r: unknown[], idx: number) => {
    const cost = Number(r[3]);
    const userCount = Number(r[1]);
    return {
      "排名": idx + 1,
      "部门": String(r[0] ?? "未分配"),
      "人数": userCount,
      "调用次数": Number(r[2]),
      "总费用(元)": Number(cost.toFixed(2)),
      "占比": totalCost > 0 ? `${((cost / totalCost) * 100).toFixed(1)}%` : "0%",
      "人均费用(元)": userCount ? Number((cost / userCount).toFixed(2)) : 0,
    };
  });

  // ===== 生成 Excel =====
  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.json_to_sheet(empRows);
  ws1["!cols"] = [
    { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, "员工费用汇总");

  const ws2 = XLSX.utils.json_to_sheet(deptRows);
  ws2["!cols"] = [
    { wch: 6 }, { wch: 14 }, { wch: 6 }, { wch: 10 },
    { wch: 12 }, { wch: 8 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "部门费用汇总");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const safeLabel = label.replace(/[^\w一-鿿]/g, "");
  const filename = `AI费用报表-${safeLabel}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
