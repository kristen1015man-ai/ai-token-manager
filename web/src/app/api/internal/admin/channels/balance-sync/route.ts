import { NextRequest, NextResponse } from "next/server";
import { requireInternalRequest } from "../../../../../../lib/internal-auth";
import { syncChannelBalances, sendBalanceAlert } from "../../../../../../lib/balance-sync";
import { safeErrorSummary } from "../../../../../../lib/safe-error";

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  let channelId: string | undefined;
  let notify = false;
  try {
    const body = await request.json();
    channelId = typeof body.channelId === "string" ? body.channelId : undefined;
    notify = body.notify === true;
  } catch {
    // Empty body is allowed for "sync all".
  }

  const result = await syncChannelBalances(channelId);
  if (notify && result.alerts.length > 0) {
    sendBalanceAlert(result.alerts).catch((err) =>
      console.error("[BalanceSync/Internal] Failed to send balance alert", safeErrorSummary(err))
    );
  }

  return NextResponse.json(result);
}
