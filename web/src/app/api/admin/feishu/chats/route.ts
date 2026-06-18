import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { listBotChats } from "../../../../../lib/feishu-bot";
import { safeErrorSummary } from "../../../../../lib/safe-error";

/**
 * GET /api/admin/feishu/chats
 * 读取当前飞书机器人所在群组，供排行榜定时发送选择群。
 */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const chats = await listBotChats();
    return NextResponse.json({ chats, syncedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[FeishuChats] list bot chats failed:", safeErrorSummary(err));
    return NextResponse.json(
      {
        error:
          "读取飞书群组失败，请检查 FEISHU_APP_SECRET、机器人能力、im:chat:read 权限，以及机器人是否已加入群组。",
      },
      { status: 502 }
    );
  }
}
