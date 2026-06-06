import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { syncChannelBalances, sendBalanceAlert } from "../../../../../lib/balance-sync";

/**
 * POST /api/admin/channels/balance-sync
 * 手动触发余额同步
 * Body: { channelId?: string }  不传=同步所有自动渠道
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  let channelId: string | undefined;
  try {
    const body = await request.json();
    channelId = body.channelId;
  } catch {
    // 无 body 也行
  }

  const result = await syncChannelBalances(channelId);

  // 如果有告警，异步发送飞书通知（不阻塞响应）
  if (result.alerts.length > 0) {
    sendBalanceAlert(result.alerts).catch(err =>
      console.error("[BalanceSync] 飞书告警发送失败:", err)
    );
  }

  return NextResponse.json(result);
}
