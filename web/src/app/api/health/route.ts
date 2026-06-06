import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "../../../lib/db";

/**
 * GET /api/health
 * 健康检查端点 — 供负载均衡器、监控服务使用
 * 无需鉴权（middleware 中已设为公开路由）
 */
export async function GET() {
  const start = Date.now();
  let dbStatus: "ok" | "error" = "ok";

  try {
    const { db } = await getDb();
    // 简单查询验证数据库可读
    await db.run(sql`SELECT 1`);
  } catch {
    dbStatus = "error";
  }

  const status = dbStatus === "ok" ? "ok" : "degraded";
  const responseTimeMs = Date.now() - start;

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "0.1.0",
    db: dbStatus,
    responseTimeMs,
  }, {
    status: status === "ok" ? 200 : 503,
  });
}
