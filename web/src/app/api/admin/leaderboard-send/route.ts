import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { sendLeaderboard } from "../../../../lib/leaderboard";
import { safeErrorSummary } from "../../../../lib/safe-error";

/**
 * POST /api/admin/leaderboard-send
 * 手动触发排行榜发送（管理员或 INTERNAL_API_KEY 认证）
 */
export async function POST(request: Request) {
  // 认证：管理员 session 或内部 API Key
  let isInternal = false;
  const { error } = await requireAdmin();
  if (error) {
    // 尝试 INTERNAL_API_KEY 认证（定时任务走这条路径）
    const internalKey = process.env.INTERNAL_API_KEY;
    const authHeader = request.headers.get("authorization");
    if (!internalKey || authHeader !== `Bearer ${internalKey}`) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }
    isInternal = true;
  }

  try {
    const result = await sendLeaderboard({ allowEmpty: !isInternal });
    return NextResponse.json({
      success: true,
      sent: result.sent,
      failed: result.failed,
      chatIds: result.chatIds,
      skippedReason: result.skippedReason || null,
    });
  } catch (err) {
    console.error("[Leaderboard API] 发送失败:", safeErrorSummary(err));
    return NextResponse.json(
      { error: "排行榜发送失败", detail: String(err) },
      { status: 500 }
    );
  }
}
