import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { sendCardMessage } from "../../../../../lib/feishu-bot";
import { formatBeijingDateTime } from "../../../../../lib/beijing-time";

/**
 * POST /api/admin/alerts/test-feishu
 * 发送测试飞书通知到当前管理员的私聊
 * 使用 App Bot SDK（不再使用 Webhook）
 */
export async function POST() {
  const { error, session } = await requireAdmin();
  if (error) return error;

  // 从 session 获取管理员的 feishuId
  const feishuId = session?.feishuId;
  if (!feishuId) {
    return NextResponse.json({ error: "当前管理员未绑定飞书账号" }, { status: 400 });
  }

  try {
    await sendCardMessage(feishuId, "open_id", {
      title: "🧪 预警通知测试",
      template: "blue",
      elements: [
        "**这是一条测试通知**\n如果你看到了这条消息，说明飞书预警通知配置成功 ✅",
        `⏰ 发送时间：${formatBeijingDateTime()}`,
      ],
    });

    return NextResponse.json({ success: true, message: "测试通知已发送，请检查飞书私聊" });
  } catch (err) {
    return NextResponse.json({
      error: `发送失败：${err instanceof Error ? err.message : "网络错误"}`,
    }, { status: 500 });
  }
}
