/**
 * 渠道余额同步模块 — 核心同步逻辑、飞书告警、余额概览
 *
 * 余额获取实现见 balance-fetchers.ts
 */
import { getDb, saveDb } from "./db";
import { ensureDecrypted } from "./crypto";
import { channels, alertSettings } from "../../../shared/schema";
import { eq } from "drizzle-orm";
import {
  isAutoProvider,
  getBalanceCurrency,
  getAlertThreshold,
  fetchDeepSeekBalance,
  fetchSiliconFlowBalance,
  fetchAlibabaBalance,
  DEFAULT_THRESHOLDS,
  type ChannelAlert,
  type SyncResult,
  type ChannelRow,
} from "./balance-fetchers";

// 重导出类型供外部使用
export type { ChannelAlert, SyncResult };
export { getBalanceOverview } from "./balance-sync-overview";

// ===== 核心同步 =====

/**
 * 同步所有支持自动同步的渠道余额
 * @param singleChannelId 可选，只同步指定渠道
 */
export async function syncChannelBalances(singleChannelId?: string): Promise<SyncResult> {
  const { db } = await getDb();

  // 查询渠道
  let channelList: ChannelRow[];
  if (singleChannelId) {
    const rows = await db.select().from(channels).where(eq(channels.id, singleChannelId));
    channelList = rows as ChannelRow[];
  } else {
    channelList = await db.select().from(channels) as ChannelRow[];
  }

  let synced = 0;
  let failed = 0;
  const alerts: ChannelAlert[] = [];

  for (const ch of channelList) {
    const effectiveSyncMode = ch.balanceSyncMode || (isAutoProvider(ch.provider) ? "auto" : "manual");

    if (effectiveSyncMode !== "auto") {
      // 手动渠道：检查余额是否低于阈值
      if (ch.balance != null) {
        const threshold = getAlertThreshold(ch);
        const currency = getBalanceCurrency(ch);
        if (ch.balance < threshold) {
          alerts.push({
            channelId: ch.id,
            channelName: ch.name,
            provider: ch.provider,
            balance: ch.balance,
            currency,
            threshold,
            severity: ch.balance < threshold * 0.2 ? "danger" : "warning",
          });
        }
      }
      continue;
    }

    // 自动同步
    let result: { balance: number; currency: string } | null = null;

    const decryptedApiKey = ensureDecrypted(ch.apiKey);
    const decryptedAccessKeySecret = ch.accessKeySecret ? ensureDecrypted(ch.accessKeySecret) : null;

    switch (ch.provider) {
      case "deepseek":
        result = await fetchDeepSeekBalance(ch.baseUrl, decryptedApiKey);
        break;
      case "siliconflow":
        result = await fetchSiliconFlowBalance(ch.baseUrl, decryptedApiKey);
        break;
      case "alibaba":
        if (ch.accessKeyId && decryptedAccessKeySecret) {
          result = await fetchAlibabaBalance(ch.accessKeyId, decryptedAccessKeySecret);
        } else {
          console.warn(`[BalanceSync] ${ch.name} (alibaba): 缺少 AccessKey ID/Secret，跳过自动同步`);
          failed++;
        }
        break;
    }

    if (result) {
      await db.update(channels).set({
        balance: result.balance,
        balanceCurrency: result.currency,
        balanceSyncedAt: new Date(),
      }).where(eq(channels.id, ch.id));

      synced++;
      console.log(`[BalanceSync] ${ch.name} (${ch.provider}): ${result.currency === "CNY" ? "¥" : "$"}${result.balance.toFixed(2)}`);

      const threshold = getAlertThreshold(ch);
      if (result.balance < threshold) {
        alerts.push({
          channelId: ch.id,
          channelName: ch.name,
          provider: ch.provider,
          balance: result.balance,
          currency: result.currency,
          threshold,
          severity: result.balance < threshold * 0.2 ? "danger" : "warning",
        });
      }
    } else {
      failed++;
      console.error(`[BalanceSync] ${ch.name} (${ch.provider}) 同步失败`);
    }
  }

  await saveDb();
  return { synced, failed, alerts };
}

// ===== 飞书告警 =====

/**
 * 格式化余额告警消息
 */
export function formatBalanceAlert(alerts: ChannelAlert[]): string {
  const lines = ["**⚠️ 渠道余额预警**", "━━━━━━━━━━━━"];

  for (const a of alerts) {
    const icon = a.severity === "danger" ? "🔴" : "🟡";
    const sym = a.currency === "CNY" ? "¥" : "$";
    const threshSym = a.currency === "CNY" ? "¥" : "$";
    lines.push(`${icon} **${a.channelName}**：${sym}${a.balance?.toFixed(2) ?? "未知"}（低于 ${threshSym}${a.threshold} 阈值）`);
  }

  lines.push("━━━━━━━━━━━━");
  lines.push("请及时充值，避免服务中断");

  return lines.join("\n");
}

/**
 * 发送余额预警到飞书
 */
export async function sendBalanceAlert(alerts: ChannelAlert[]): Promise<boolean> {
  if (alerts.length === 0) return true;

  const { db } = await getDb();
  const webhookRow = await db.select().from(alertSettings).where(eq(alertSettings.key, "feishu_webhook_url")).limit(1);
  const webhookUrl = webhookRow[0]?.value;

  if (!webhookUrl) {
    console.log("[BalanceSync] 未配置飞书 Webhook，跳过告警发送");
    return false;
  }

  const enabledRow = await db.select().from(alertSettings).where(eq(alertSettings.key, "feishu_notify_enabled")).limit(1);
  if (enabledRow[0]?.value !== "true") {
    console.log("[BalanceSync] 飞书通知未启用，跳过告警发送");
    return false;
  }

  const dangerCount = alerts.filter(a => a.severity === "danger").length;
  const warningCount = alerts.filter(a => a.severity === "warning").length;

  const payload = {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: dangerCount > 0 ? "🔴 渠道余额告急" : "🟡 渠道余额预警" },
        template: dangerCount > 0 ? "red" : "orange",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: formatBalanceAlert(alerts),
          },
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `⏰ 检测时间：${new Date().toLocaleString("zh-CN")}`,
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
      console.error(`[BalanceSync] 飞书告警发送失败: ${result.msg}`);
      return false;
    }
    console.log(`[BalanceSync] 飞书告警已发送: ${dangerCount} 个严重, ${warningCount} 个警告`);
    return true;
  } catch (err) {
    console.error(`[BalanceSync] 飞书告警发送异常:`, err);
    return false;
  }
}
