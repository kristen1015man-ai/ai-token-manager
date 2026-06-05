import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { getDb } from "../../../../../lib/db";
import { alertSettings } from "../../../../../../../shared/schema";

/** POST /api/admin/alerts/test-feishu — 发送测试飞书通知 */
export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const { eq } = await import("drizzle-orm");

  // 读取 webhook URL
  const webhookRow = await db.select().from(alertSettings).where(eq(alertSettings.key, "feishu_webhook_url")).limit(1);
  const webhookUrl = webhookRow[0]?.value;

  if (!webhookUrl) {
    return NextResponse.json({ error: "请先设置飞书 Webhook 地址" }, { status: 400 });
  }

  // 构造飞书消息卡片
  const payload = {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: "🧪 预警通知测试" },
        template: "blue",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: "**这是一条测试通知**\n如果你看到了这条消息，说明飞书预警通知配置成功 ✅",
          },
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `⏰ 发送时间：${new Date().toLocaleString("zh-CN")}`,
          },
        },
      ],
    },
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await resp.json() as { code?: number; msg?: string };
    if (result.code !== 0) {
      return NextResponse.json({
        error: `飞书返回错误：${result.msg || "未知错误"}`,
      }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: "测试通知已发送，请检查飞书群" });
  } catch (err) {
    return NextResponse.json({
      error: `发送失败：${err instanceof Error ? err.message : "网络错误"}`,
    }, { status: 500 });
  }
}
