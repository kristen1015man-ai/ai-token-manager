/** 渠道管理页 — 纯函数工具 */
import { AUTO_PROVIDERS, DEFAULT_THRESHOLDS, type Channel } from "./channel-types";

/** 判断是否自动同步供应商 */
export function isAuto(ch: Channel): boolean {
  if (ch.balanceSyncMode === "auto") return true;
  if (ch.balanceSyncMode === "manual") return false;
  return AUTO_PROVIDERS.includes(ch.provider || "");
}

/** 获取余额显示文本 */
export function getBalanceDisplay(ch: Channel): string | null {
  if (ch.balance == null) return null;
  const cur = ch.balanceCurrency || ch.currency || "CNY";
  const sym = cur === "USD" ? "$" : "¥";
  return `${sym}${Number(ch.balance).toFixed(2)}`;
}

/** 获取余额状态 */
export function getBalanceStatus(ch: Channel): "normal" | "warning" | "danger" | "none" {
  if (ch.balance == null) return "none";
  const threshold = ch.balanceAlertThreshold ?? DEFAULT_THRESHOLDS[ch.balanceCurrency || ch.currency || "CNY"] ?? 100;
  if (ch.balance < threshold * 0.2) return "danger";
  if (ch.balance < threshold) return "warning";
  return "normal";
}

/** 格式化同步时间 */
export function formatSyncTime(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
}
