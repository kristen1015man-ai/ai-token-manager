import { NextResponse } from "next/server";

/**
 * GET /api/health
 * 健康检查端点 — 供 Railway healthcheck、负载均衡器使用
 * 无需鉴权（middleware 中已设为公开路由）
 * 故意不依赖数据库，避免构建/运行时依赖链导致路由被跳过
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "0.1.0",
  });
}
