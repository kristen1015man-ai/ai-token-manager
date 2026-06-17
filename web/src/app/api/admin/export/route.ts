import { NextRequest } from "next/server";
import { requireRole } from "../../../../lib/admin-check";
import { getDb, type SqliteExec } from "../../../../lib/db";
import { getTimeRange } from "../../../../lib/time-range";
import { parseRoles } from "../../../../lib/permissions";

type ExportRow = Record<string, string | number | null | undefined>;

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Sheet";
}

function cellXml(value: string | number | null | undefined): string {
  const isNumber = typeof value === "number" && Number.isFinite(value);
  return `<Cell><Data ss:Type="${isNumber ? "Number" : "String"}">${escapeXml(value)}</Data></Cell>`;
}

function worksheetXml(name: string, rows: ExportRow[]): string {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const headerRow = `<Row ss:StyleID="header">${headers.map((header) => cellXml(header)).join("")}</Row>`;
  const bodyRows = rows
    .map((row) => `<Row>${headers.map((header) => cellXml(row[header])).join("")}</Row>`)
    .join("");

  return `
    <Worksheet ss:Name="${escapeXml(safeSheetName(name))}">
      <Table>${headerRow}${bodyRows}</Table>
    </Worksheet>`;
}

function workbookXml(sheets: Array<{ name: string; rows: ExportRow[] }>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#F3F4F6" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  ${sheets.map((sheet) => worksheetXml(sheet.name, sheet.rows)).join("")}
</Workbook>`;
}

/**
 * 导出 Excel 报表（财务视角）
 *
 * 权限：管理员、财务、部门负责人均可导出
 *
 * - 只按时间段筛选
 * - 按员工汇总（不拆每条调用记录）
 * - 不显示 token 和调用次数，只显示费用
 *
 * Sheet 1: 员工费用汇总（按部门+姓名排序）
 * Sheet 2: 部门费用汇总（排名、占比、人均）
 * Sheet 3: 渠道费用明细（按渠道+模型拆分）
 */
export async function GET(request: NextRequest) {
  const { session, error } = await requireRole("admin", "finance", "dept_manager");
  if (error) return error;

  const range = request.nextUrl.searchParams.get("range") || "30d";
  const { start, end, label } = getTimeRange(range);

  const { sqlite } = await getDb();
  const dbAny = sqlite as unknown as SqliteExec;

  // 构建时间条件
  let timeWhere = `ul.created_at >= ?`;
  const params: number[] = [start];
  if (end) {
    timeWhere += ` AND ul.created_at < ?`;
    params.push(end);
  }
  const roles = parseRoles(session.role);
  const isDeptManagerOnly = roles.includes("dept_manager") && !roles.includes("admin") && !roles.includes("finance");
  const scopeWhere = isDeptManagerOnly ? ` AND u.department_id = ?` : "";
  const scopedParams = isDeptManagerOnly ? [...params, session.departmentId || ""] : params;

  // ===== 虚拟部门黑名单 =====
  const VIRTUAL_DEPTS = ["管理部"];

  // ===== Sheet 1: 员工费用汇总（仅活跃用户） =====
  const empResult = dbAny.exec(
    `SELECT u.name, u.department,
       COALESCE(SUM(ul.cost), 0) as total_cost
     FROM users u
     LEFT JOIN usage_logs ul ON ul.user_id = u.id AND ${timeWhere}
     WHERE u.status = 'active'${scopeWhere}
     GROUP BY u.id
     HAVING total_cost > 0
     ORDER BY u.department, total_cost DESC`,
    scopedParams
  );

  const empRowsFiltered = (empResult[0]?.values ?? [])
    .map((r: unknown[]) => ({
      "员工姓名": String(r[0] ?? ""),
      "部门": String(r[1] ?? "未分配"),
      "费用(元)": Number(Number(r[2]).toFixed(2)),
    }))
    .filter((r) => !VIRTUAL_DEPTS.includes(r["部门"]));

  // ===== Sheet 2: 部门费用汇总（仅活跃用户） =====
  const deptParams = [...params];
  const deptResult = dbAny.exec(
    `SELECT u.department as dept,
       COUNT(DISTINCT u.id) as user_count,
       COALESCE(SUM(ul.cost), 0) as total_cost
     FROM users u
     LEFT JOIN usage_logs ul ON ul.user_id = u.id AND ${timeWhere}
     WHERE u.status = 'active'${scopeWhere}
     GROUP BY u.department
     ORDER BY total_cost DESC`,
    isDeptManagerOnly ? [...deptParams, session.departmentId || ""] : deptParams
  );

  interface DeptRaw { dept: string; userCount: number; totalCost: number }
  const deptRowsRaw: DeptRaw[] = (deptResult[0]?.values ?? [])
    .map((r: unknown[]) => ({
      dept: String(r[0] ?? "未分配"),
      userCount: Number(r[1]),
      totalCost: Number(r[2]),
    }))
    .filter((d: DeptRaw) => !VIRTUAL_DEPTS.includes(d.dept));

  const filteredTotalCost = deptRowsRaw.reduce((sum: number, d: DeptRaw) => sum + d.totalCost, 0);

  const deptRows = deptRowsRaw.map((d: DeptRaw, idx: number) => ({
    "排名": idx + 1,
    "部门": d.dept,
    "人数": d.userCount,
    "总费用(元)": Number(d.totalCost.toFixed(2)),
    "占比": filteredTotalCost > 0 ? `${((d.totalCost / filteredTotalCost) * 100).toFixed(1)}%` : "0%",
    "人均费用(元)": d.userCount ? Number((d.totalCost / d.userCount).toFixed(2)) : 0,
  }));

  // ===== Sheet 3: 渠道费用明细 =====
  const channelResult = isDeptManagerOnly ? [] : dbAny.exec(
    `SELECT c.name as channel_name,
       ul.model,
       COALESCE(SUM(ul.cost), 0) as total_cost,
       COALESCE(SUM(ul.input_tokens), 0) as input_tokens,
       COALESCE(SUM(ul.output_tokens), 0) as output_tokens
     FROM usage_logs ul
     LEFT JOIN channels c ON ul.channel_id = c.id
     WHERE ${timeWhere.replace(/ul\./g, "ul.")}
     GROUP BY ul.channel_id, ul.model
     ORDER BY total_cost DESC`,
    params
  );

  const channelTotalCost = (channelResult[0]?.values ?? [])
    .reduce((sum: number, r: unknown[]) => sum + Number(r[2]), 0);

  const channelRows = (channelResult[0]?.values ?? []).map((r: unknown[]) => {
    const cost = Number(r[2]);
    return {
      "渠道": String(r[0] ?? "未知渠道"),
      "模型": String(r[1] ?? ""),
      "费用(元)": Number(cost.toFixed(2)),
      "占比": channelTotalCost > 0 ? `${((cost / channelTotalCost) * 100).toFixed(1)}%` : "0%",
      "输入Token": Number(r[3]),
      "输出Token": Number(r[4]),
    };
  });

  const sheets: Array<{ name: string; rows: ExportRow[] }> = [
    { name: "员工费用汇总", rows: empRowsFiltered },
    { name: "部门费用汇总", rows: deptRows },
  ];
  if (!isDeptManagerOnly) {
    sheets.push({ name: "渠道费用明细", rows: channelRows });
  }
  const xml = workbookXml(sheets);

  const safeLabel = label.replace(/[^\w一-鿿]/g, "");
  const filename = `Sparkloom-billing-report-${safeLabel}.xls`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
