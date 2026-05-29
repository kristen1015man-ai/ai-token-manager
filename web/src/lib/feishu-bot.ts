import * as lark from "@larksuiteoapi/node-sdk";

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "";

const client = new lark.Client({
  appId: FEISHU_APP_ID,
  appSecret: FEISHU_APP_SECRET,
});

/**
 * 发送飞书私聊消息给指定用户
 */
export async function sendPrivateMessage(feishuUserId: string, text: string) {
  try {
    await client.im.v1.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: feishuUserId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
    console.log(`[Feishu] Sent private message to ${feishuUserId}`);
  } catch (err) {
    console.error("[Feishu] Failed to send private message:", err);
  }
}

/**
 * 发送飞书群消息（通过 webhook 或指定 chat_id）
 */
export async function sendGroupMessage(chatId: string, text: string) {
  try {
    await client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
    console.log(`[Feishu] Sent group message to ${chatId}`);
  } catch (err) {
    console.error("[Feishu] Failed to send group message:", err);
  }
}

/**
 * 生成额度预警消息
 */
export function formatQuotaAlert(params: {
  userName: string;
  department: string;
  used: number;
  limit: number;
  percent: number;
  remainingDays: number;
}): string {
  return `🤖 AI Token 管家 提醒

⚠️ ${params.userName} 的月度额度已达 ${params.percent}%
━━━━━━━━━━━━━━━━━
👤 员工：${params.userName}（${params.department}）
💰 已用：¥${params.used.toFixed(2)} / ¥${params.limit.toFixed(2)}
📅 剩余天数：${params.remainingDays} 天
━━━━━━━━━━━━━━━━━
💡 管理员可在后台调整额度`;
}
