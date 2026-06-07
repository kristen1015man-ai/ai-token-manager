import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, getRawExec } from "../../../../lib/db";

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
    const db = getRawExec(sqlite);

    const cols = db.exec(`PRAGMA table_info(users)`);
    const colNames = (cols[0]?.values ?? []).map((r: unknown[]) => String(r[1]));

    const userCount = db.exec(`SELECT COUNT(*) FROM users`);
    const logCount = db.exec(`SELECT COUNT(*) FROM usage_logs`);

    let testQuery = "FAILED";
    try {
      db.exec(`SELECT u.name, u.department FROM users u LIMIT 1`);
      testQuery = "OK - department column exists";
    } catch (e: unknown) {
      testQuery = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
    }

    return NextResponse.json({
      columns: colNames,
      userCount: userCount[0]?.values?.[0]?.[0] ?? 0,
      logCount: logCount[0]?.values?.[0]?.[0] ?? 0,
      departmentTest: testQuery,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
