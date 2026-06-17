/**
 * balance-sync-overview.ts — 余额概览（供 overview API 使用）
 */
import { getDb } from "./db";
import { channels } from "../../../shared/schema";
import { DEFAULT_THRESHOLDS, type ChannelAlert } from "./balance-fetchers";

/**
 * 获取所有渠道余额概览
 */
export async function getBalanceOverview() {
  const { db } = await getDb();
  const channelList = await db.select({
    id: channels.id,
    name: channels.name,
    provider: channels.provider,
    currency: channels.currency,
    balance: channels.balance,
    balanceCurrency: channels.balanceCurrency,
    balanceSyncedAt: channels.balanceSyncedAt,
    balanceAlertThreshold: channels.balanceAlertThreshold,
  }).from(channels);

  // 汇总
  const totals: Record<string, number> = {};
  const alerts: ChannelAlert[] = [];

  for (const ch of channelList) {
    const bal = ch.balance;
    const currency = ch.balanceCurrency || ch.currency || "CNY";

    if (bal != null) {
      totals[currency] = (totals[currency] || 0) + bal;
    }

    // 检查阈值
    if (bal != null) {
      const threshold = ch.balanceAlertThreshold ?? DEFAULT_THRESHOLDS[currency] ?? 100;
      if (bal < threshold) {
        alerts.push({
          channelId: ch.id,
          channelName: ch.name,
          provider: ch.provider,
          balance: bal,
          currency,
          threshold,
          severity: bal < threshold * 0.2 ? "danger" : "warning",
        });
      }
    }
  }

  return {
    channels: channelList.map(ch => ({
      id: ch.id,
      name: ch.name,
      provider: ch.provider,
      currency: ch.currency,
      balance: ch.balance,
      balanceCurrency: ch.balanceCurrency,
      balanceSyncedAt: ch.balanceSyncedAt,
    })),
    totals,
    alerts,
  };
}
