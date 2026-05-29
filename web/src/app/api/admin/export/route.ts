import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const month = request.nextUrl.searchParams.get("month") || "";
  const { sqlite } = await getDb();

  // 解析月份范围
  let startDate: number;
  let endDate: number;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    startDate = Math.floor(new Date(y, m - 1, 1).getTime() / 1000);
    endDate = Math.floor(new Date(y, m, 1).getTime() / 1000);
  } else {
    const now = new Date();
    startDate = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
    endDate = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() / 1000);
  }

  const result = (sqlite as any).exec(
    `SELECT u.name, u.department, u.email, ul.model,
       ul.input_tokens, ul.output_tokens, ul.total_tokens, ul.cost,
       datetime(ul.created_at, 'unixepoch', 'localtime') as time
     FROM usage_logs ul
     JOIN users u ON ul.user_id = u.id
     WHERE ul.created_at >= ? AND ul.created_at < ?
     ORDER BY ul.created_at DESC`,
    [startDate, endDate]
  );

  // 生成 CSV（比 xlsx 更轻量，Excel 可直接打开）
  const headers = ["员工姓名", "部门", "邮箱", "模型", "输入Token", "输出Token", "总Token", "费用(元)", "时间"];
  const rows = (result[0]?.values ?? []).map((r: unknown[]) =>
    [r[0], r[1], r[2], r[3], r[4], r[5], r[6], Number(r[7]).toFixed(4), r[8]]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(",")
  );

  const csv = "﻿" + headers.join(",") + "\n" + rows.join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-usage-${month || "current"}.csv"`,
    },
  });
}
