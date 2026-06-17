import * as lark from "@larksuiteoapi/node-sdk";
import { safeErrorSummary } from "./safe-error";
import { BRAND_NAME } from "./brand";

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "";

let client: lark.Client | null = null;

function getClient(): lark.Client | null {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    console.warn("[FeishuBot] FEISHU_APP_ID/FEISHU_APP_SECRET not configured, skip send");
    return null;
  }
  if (!client) {
    client = new lark.Client({
      appId: FEISHU_APP_ID,
      appSecret: FEISHU_APP_SECRET,
    });
  }
  return client;
}

/**
 * 发送飞书私聊消息给指定用户
 */
export async function sendPrivateMessage(feishuUserId: string, text: string) {
  try {
    const feishuClient = getClient();
    if (!feishuClient) throw new Error("FEISHU_APP_ID/FEISHU_APP_SECRET not configured");
    await feishuClient.im.v1.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: feishuUserId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
    console.log(`[Feishu] Sent private message to ${feishuUserId}`);
  } catch (err) {
    console.error("[Feishu] Failed to send private message:", safeErrorSummary(err));
    throw err;
  }
}

/**
 * 发送飞书交互式卡片消息（私聊）
 * 用于异常告警等富文本通知
 */
export async function sendCardMessage(
  receiveId: string,
  receiveIdType: "open_id" | "chat_id",
  card: {
    title: string;
    template?: "red" | "orange" | "blue" | "green";
    elements: string[];  // Markdown 内容行
  }
) {
  try {
    const feishuClient = getClient();
    if (!feishuClient) throw new Error("FEISHU_APP_ID/FEISHU_APP_SECRET not configured");
    await feishuClient.im.v1.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        msg_type: "interactive",
        content: JSON.stringify({
          config: { wide_screen_mode: true },
          header: {
            title: { tag: "plain_text", content: card.title },
            template: card.template || "blue",
          },
          elements: card.elements.map((md) => ({
            tag: "div",
            text: { tag: "lark_md", content: md },
          })),
        }),
      },
    });
    console.log(`[FeishuBot] Card sent to ${receiveIdType}=${receiveId}`);
  } catch (err) {
    console.error("[FeishuBot] Failed to send card:", safeErrorSummary(err));
    throw err;
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
  return `🤖 ${BRAND_NAME} 提醒

⚠️ ${params.userName} 的月度额度已达 ${params.percent}%
━━━━━━━━━━━━━━━━━
👤 员工：${params.userName}（${params.department}）
💰 已用：¥${params.used.toFixed(2)} / ¥${params.limit.toFixed(2)}
📅 剩余天数：${params.remainingDays} 天
━━━━━━━━━━━━━━━━━
💡 管理员可在后台调整额度`;
}
