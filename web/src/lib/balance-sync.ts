import { eq } from "drizzle-orm";
import { channels } from "../../../shared/schema";
import { ensureDecrypted, isEncrypted } from "./crypto";
import { getDb, saveDb } from "./db";
import { notifyAlert } from "./notification-router";
import { formatBeijingDateTime } from "./beijing-time";
import { validateProviderApiKey } from "./provider-secrets";
import {
  DEFAULT_THRESHOLDS,
  fetchAlibabaBalance,
  fetchDeepSeekBalance,
  fetchSiliconFlowBalance,
  getAlertThreshold,
  getBalanceCurrency,
  inferAutoProvider,
  isAutoProvider,
  type ChannelAlert,
  type ChannelRow,
  type ProviderBalanceResult,
  type SyncResult,
} from "./balance-fetchers";

export type { ChannelAlert, SyncResult };
export { getBalanceOverview } from "./balance-sync-overview";

async function markBalanceUnknown(ch: ChannelRow): Promise<void> {
  const { db } = await getDb();
  await db.update(channels).set({
    balance: null,
    balanceCurrency: null,
    balanceSyncedAt: null,
  }).where(eq(channels.id, ch.id));
  ch.balance = null;
  ch.balanceCurrency = null;
}

export async function syncChannelBalances(singleChannelId?: string): Promise<SyncResult> {
  const { db } = await getDb();
  const channelList = singleChannelId
    ? (await db.select().from(channels).where(eq(channels.id, singleChannelId)) as ChannelRow[])
    : (await db.select().from(channels) as ChannelRow[]);

  let synced = 0;
  let failed = 0;
  const alerts: ChannelAlert[] = [];
  const errors: SyncResult["errors"] = [];

  for (const ch of channelList) {
    if (ch.status !== "active") continue;

    const provider = inferAutoProvider(ch.provider, ch.baseUrl, ch.name, ch.id);
    const effectiveSyncMode = ch.balanceSyncMode || (isAutoProvider(provider) ? "auto" : "manual");

    if (provider && provider !== ch.provider) {
      await db.update(channels).set({ provider }).where(eq(channels.id, ch.id));
      ch.provider = provider;
    }

    if (effectiveSyncMode !== "auto") {
      collectLowBalanceAlert(ch, provider, alerts);
      continue;
    }

    const decryptedApiKey = ensureDecrypted(ch.apiKey);
    if (!decryptedApiKey || (isEncrypted(ch.apiKey) && decryptedApiKey === ch.apiKey)) {
      failed++;
      const message = "API Key 无法解密，请在渠道管理中重新录入";
      console.error(`[BalanceSync] ${ch.name} (${provider}) ${message}`);
      errors.push({ channelId: ch.id, channelName: ch.name, message });
      await markBalanceUnknown(ch);
      continue;
    }

    const keyWarning = validateProviderApiKey(provider, decryptedApiKey);
    if (keyWarning) {
      failed++;
      const message = `${keyWarning}。请在渠道管理中重新录入完整供应商 API Key。`;
      console.error(`[BalanceSync] ${ch.name} (${provider}) ${message}`);
      errors.push({ channelId: ch.id, channelName: ch.name, message });
      await markBalanceUnknown(ch);
      continue;
    }

    const result = await fetchChannelBalance(ch, provider, decryptedApiKey);
    if (!result.ok) {
      failed++;
      console.error(`[BalanceSync] ${ch.name} (${provider}) ${result.message}`);
      errors.push({ channelId: ch.id, channelName: ch.name, message: result.message });
      await markBalanceUnknown(ch);
      continue;
    }

    await db.update(channels).set({
      balance: result.balance,
      balanceCurrency: result.currency,
      balanceSyncedAt: new Date(),
    }).where(eq(channels.id, ch.id));

    synced++;
    ch.balance = result.balance;
    ch.balanceCurrency = result.currency;
    console.log(`[BalanceSync] ${ch.name} (${provider}): ${result.currency === "CNY" ? "¥" : "$"}${result.balance.toFixed(4)}`);
    collectLowBalanceAlert(ch, provider, alerts);
  }

  await saveDb();
  return { synced, failed, alerts, errors };
}

async function fetchChannelBalance(
  ch: ChannelRow,
  provider: string | null,
  decryptedApiKey: string,
): Promise<ProviderBalanceResult> {
  switch (provider) {
    case "deepseek":
      return fetchDeepSeekBalance(ch.baseUrl, decryptedApiKey);
    case "siliconflow":
      return fetchSiliconFlowBalance(ch.baseUrl, decryptedApiKey);
    case "alibaba": {
      const decryptedAccessKeySecret = ch.accessKeySecret ? ensureDecrypted(ch.accessKeySecret) : null;
      if (ch.accessKeySecret && decryptedAccessKeySecret === ch.accessKeySecret) {
        return { ok: false, message: "AccessKey Secret 无法解密，请重新录入" };
      }
      if (!ch.accessKeyId || !decryptedAccessKeySecret) {
        return { ok: false, message: "缺少 AccessKey ID/Secret，无法自动同步阿里云余额" };
      }
      return fetchAlibabaBalance(ch.accessKeyId, decryptedAccessKeySecret);
    }
    default:
      return { ok: false, message: "该渠道未配置支持余额同步的供应商" };
  }
}

function collectLowBalanceAlert(ch: ChannelRow, provider: string | null, alerts: ChannelAlert[]): void {
  if (ch.status !== "active") return;
  if (ch.balance == null) return;
  const threshold = getAlertThreshold(ch);
  const currency = getBalanceCurrency(ch);
  if (ch.balance >= threshold) return;
  alerts.push({
    channelId: ch.id,
    channelName: ch.name,
    provider,
    balance: ch.balance,
    currency,
    threshold,
    severity: ch.balance < threshold * 0.2 ? "danger" : "warning",
  });
}

async function refreshCurrentAlerts(alerts: ChannelAlert[]): Promise<ChannelAlert[]> {
  if (alerts.length === 0) return [];

  const { db } = await getDb();
  const currentAlerts: ChannelAlert[] = [];

  for (const alert of alerts) {
    const rows = await db.select().from(channels).where(eq(channels.id, alert.channelId)).limit(1) as ChannelRow[];
    const ch = rows[0];
    if (!ch || ch.status !== "active" || ch.balance == null) continue;

    const provider = inferAutoProvider(ch.provider, ch.baseUrl, ch.name, ch.id);
    const threshold = getAlertThreshold(ch);
    const currency = getBalanceCurrency(ch);
    if (ch.balance >= threshold) continue;

    currentAlerts.push({
      channelId: ch.id,
      channelName: ch.name,
      provider,
      balance: ch.balance,
      currency,
      threshold,
      severity: ch.balance < threshold * 0.2 ? "danger" : "warning",
    });
  }

  return currentAlerts;
}

export function formatBalanceAlert(alerts: ChannelAlert[]): string {
  const hasDanger = alerts.some((alert) => alert.severity === "danger");
  const heading = hasDanger ? "渠道余额告急" : "渠道余额预警";
  const lines = [`**${heading}**`, "----------------"];
  for (const alert of alerts) {
    const level = alert.severity === "danger" ? "告急" : "预警";
    const symbol = alert.currency === "USD" ? "$" : "¥";
    lines.push(`${level}：${alert.channelName} 当前 ${symbol}${alert.balance?.toFixed(4) ?? "未知"}，低于阈值 ${symbol}${alert.threshold}`);
  }
  lines.push("----------------");
  lines.push("请及时充值，避免服务中断。");
  return lines.join("\n");
}

export async function sendBalanceAlert(alerts: ChannelAlert[]): Promise<boolean> {
  const currentAlerts = await refreshCurrentAlerts(alerts);
  if (currentAlerts.length === 0) {
    console.log("[BalanceSync] 余额提醒跳过：发送前复核时余额已恢复或渠道已停用");
    return true;
  }

  if (process.env.BALANCE_ALERT_NOTIFY_ENABLED === "false") {
    console.log("[BalanceSync] 余额不足通知已禁用 (BALANCE_ALERT_NOTIFY_ENABLED=false)");
    return true;
  }

  const dangerCount = currentAlerts.filter((alert) => alert.severity === "danger").length;
  const warningCount = currentAlerts.filter((alert) => alert.severity === "warning").length;
  const message = formatBalanceAlert(currentAlerts);
  const result = await notifyAlert({
    type: "balance_low",
    targetId: "batch",
    message,
    card: {
      title: dangerCount > 0 ? "渠道余额告急" : "渠道余额预警",
      template: dangerCount > 0 ? "red" : "orange",
      elements: [
        message,
        `检测时间：${formatBeijingDateTime()}`,
      ],
    },
  });

  console.log(`[BalanceSync] 余额提醒发送结果: ${result.sent} 成功, ${result.skipped} 跳过 (${dangerCount} 告急, ${warningCount} 预警)`);
  return result.sent > 0;
}

export { DEFAULT_THRESHOLDS };
