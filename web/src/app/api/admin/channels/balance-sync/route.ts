import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { syncChannelBalances, sendBalanceAlert } from "../../../../../lib/balance-sync";
import { apiHandler } from "../../../../../lib/api-handler";
import { safeErrorSummary } from "../../../../../lib/safe-error";

/**
 * 认证检查：支持 INTERNAL_API_KEY Bearer token（auto-sync 调用）
 * 或管理员 session（手动触发）
 */
async function authenticate(request: NextRequest): Promise<NextResponse | null> {
  const authHeader = request.headers.get("Authorization") || "";
  const internalKey = process.env.INTERNAL_API_KEY;

  if (internalKey && authHeader === `Bearer ${internalKey}`) {
    return null; // Internal API 调用 — 通过
  }

  const { error: authError } = await requireAdmin();
  return authError || null;
}

/**
 * POST /api/admin/channels/balance-sync
 * 手动/自动触发余额同步
 * Body: { channelId?: string }  不传=同步所有自动渠道
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authError = await authenticate(request);
  if (authError) return authError;

  let channelId: string | undefined;
  let notify = false;
  try {
    const body = await request.json();
    channelId = body.channelId;
    notify = body.notify === true;
  } catch {
    // 无 body 也行；默认只同步不发飞书通知
  }

  const result = await syncChannelBalances(channelId);

  // 如果有告警，异步发送飞书通知（不阻塞响应）
  if (notify && result.alerts.length > 0) {
    sendBalanceAlert(result.alerts).catch(err =>
      console.error("[BalanceSync] 飞书告警发送失败:", safeErrorSummary(err))
    );
  }

  return NextResponse.json(result);
});
