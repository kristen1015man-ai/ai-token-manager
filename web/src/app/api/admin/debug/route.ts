import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";

export async function GET() {
  // 鉴权：仅管理员可访问
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  // 生产环境禁用 debug 端点
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Debug endpoint disabled in production" }, { status: 403 });
  }

  try {
    const { sqlite } = await getDb();
    const dbAny = sqlite as any;

    const cols = dbAny.exec(`PRAGMA table_info(users)`);
    const colNames = (cols[0]?.values ?? []).map((r: unknown[]) => String(r[1]));

    const userCount = dbAny.exec(`SELECT COUNT(*) FROM users`);
    const logCount = dbAny.exec(`SELECT COUNT(*) FROM usage_logs`);

    let testQuery = "FAILED";
    try {
      const test = dbAny.exec(`SELECT u.name, u.department FROM users u LIMIT 1`);
      testQuery = "OK - department column exists";
    } catch (e: any) {
      testQuery = `FAILED: ${e.message}`;
    }

    return NextResponse.json({
      columns: colNames,
      userCount: userCount[0]?.values?.[0]?.[0] ?? 0,
      logCount: logCount[0]?.values?.[0]?.[0] ?? 0,
      departmentTest: testQuery,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
