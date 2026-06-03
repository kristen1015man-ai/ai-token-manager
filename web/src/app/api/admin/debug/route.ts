import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";

export async function GET() {
  try {
    const { sqlite } = await getDb();
    const dbAny = sqlite as any;

    // 检查 users 表列
    const cols = dbAny.exec(`PRAGMA table_info(users)`);
    const colNames = (cols[0]?.values ?? []).map((r: unknown[]) => String(r[1]));

    // 检查 users 数量
    const userCount = dbAny.exec(`SELECT COUNT(*) FROM users`);

    // 检查 usage_logs 数量
    const logCount = dbAny.exec(`SELECT COUNT(*) FROM usage_logs`);

    // 简单查询测试
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
