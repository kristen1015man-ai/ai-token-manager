import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { sendLeaderboard } from "../../../../lib/leaderboard";
import { safeErrorSummary } from "../../../../lib/safe-error";

export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const result = await sendLeaderboard({ allowEmpty: true });
    return NextResponse.json({
      success: true,
      sent: result.sent,
      failed: result.failed,
      chatIds: result.chatIds,
      skippedReason: result.skippedReason || null,
    });
  } catch (err) {
    console.error("[Leaderboard API] Send failed", safeErrorSummary(err));
    return NextResponse.json(
      { error: "Leaderboard send failed", detail: String(err) },
      { status: 500 }
    );
  }
}
