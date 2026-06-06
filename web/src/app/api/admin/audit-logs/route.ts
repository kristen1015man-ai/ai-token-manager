import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { queryAuditLogs } from "../../../../lib/audit-log";

/**
 * GET /api/admin/audit-logs
 * 查询管理员操作审计日志
 *
 * Query params:
 *   targetType - 筛选目标类型（channel, user, model 等）
 *   action     - 筛选操作类型（create, update, delete 等）
 *   adminId    - 筛选操作人
 *   limit      - 每页条数（默认 50，最大 200）
 *   offset     - 偏移量
 */
export async function GET(request: NextRequest) {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);

  const result = await queryAuditLogs({
    targetType: searchParams.get("targetType") || undefined,
    action: searchParams.get("action") || undefined,
    adminId: searchParams.get("adminId") || undefined,
    limit: parseInt(searchParams.get("limit") || "50", 10),
    offset: parseInt(searchParams.get("offset") || "0", 10),
  });

  return NextResponse.json(result);
}
