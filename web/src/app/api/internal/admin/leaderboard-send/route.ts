import { NextResponse } from "next/server";
import { requireInternalRequest } from "../../../../../lib/internal-auth";
import { sendLeaderboard } from "../../../../../lib/leaderboard";
import { safeErrorSummary } from "../../../../../lib/safe-error";

export async function POST(request: Request) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  try {
    const result = await sendLeaderboard({ allowEmpty: false });
    return NextResponse.json({
      success: true,
      sent: result.sent,
      failed: result.failed,
      chatIds: result.chatIds,
      skippedReason: result.skippedReason || null,
    });
  } catch (err) {
    console.error("[Leaderboard/Internal] Send failed", safeErrorSummary(err));
    return NextResponse.json(
      { error: "Leaderboard send failed", detail: String(err) },
      { status: 500 }
    );
  }
}
