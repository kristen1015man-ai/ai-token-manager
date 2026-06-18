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

export async function sendCardMessage(
  receiveId: string,
  receiveIdType: "open_id" | "chat_id",
  card: {
    title: string;
    template?: "red" | "orange" | "blue" | "green";
    elements: string[];
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

export interface BotChat {
  chatId: string;
  name: string;
  avatar: string | null;
  description: string | null;
  external: boolean;
  chatStatus: string | null;
}

export async function listBotChats(): Promise<BotChat[]> {
  const feishuClient = getClient();
  if (!feishuClient) throw new Error("FEISHU_APP_ID/FEISHU_APP_SECRET not configured");

  const chats: BotChat[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  do {
    const resp = await feishuClient.im.v1.chat.list({
      params: {
        user_id_type: "open_id",
        sort_type: "ByActiveTimeDesc",
        page_size: 100,
        page_token: pageToken,
      },
    });

    if (resp.code && resp.code !== 0) {
      throw new Error(`Feishu chat list failed: code=${resp.code}, msg=${resp.msg || ""}`);
    }

    for (const chat of resp.data?.items || []) {
      if (!chat.chat_id || chat.chat_status === "dissolved") continue;
      chats.push({
        chatId: chat.chat_id,
        name: chat.name || chat.chat_id,
        avatar: chat.avatar || null,
        description: chat.description || null,
        external: Boolean(chat.external),
        chatStatus: chat.chat_status || null,
      });
    }

    pageToken = resp.data?.has_more ? resp.data?.page_token : undefined;
    pageCount += 1;
    if (pageCount > 20) {
      throw new Error("Feishu chat list exceeded pagination guard");
    }
  } while (pageToken);

  return chats;
}

export function formatQuotaAlert(params: {
  userName: string;
  department: string;
  used: number;
  limit: number;
  percent: number;
  remainingDays: number;
  threshold?: number;
}): string {
  const percentText = params.percent.toFixed(1);
  const status = params.percent >= 100 ? "已达到或超过月度额度" : `已达到 ${percentText}%`;
  const thresholdLine = params.threshold === undefined ? "" : `提醒阈值：${params.threshold}%\n`;

  return `${BRAND_NAME} 额度提醒

${params.userName} ${status}
员工：${params.userName}（${params.department}）
已用：¥${params.used.toFixed(2)} / ¥${params.limit.toFixed(2)}
当前占比：${percentText}%
${thresholdLine}本月剩余天数：${params.remainingDays} 天

请合理安排调用，必要时联系管理员调整额度。`;
}
