/**
 * 渠道余额同步模块
 *
 * 支持：
 * - DeepSeek: GET {baseUrl}/user/balance → balance_infos[0].total_balance
 * - 硅基流动: GET {baseUrl}/v1/user/info → data.totalBalance
 * - 阿里千问: 阿里云 BSS API QueryAccountBalance（需 AccessKey ID + Secret）
 * - 其他供应商: 手动填写（跳过自动同步）
 *
 * 阈值检查 → 低余额告警 → 飞书通知
 */

import { createHmac } from "crypto";
import { getDb, saveDb } from "./db";
import { channels, alertSettings } from "../../../shared/schema";
import { eq } from "drizzle-orm";
import { ensureDecrypted } from "./crypto";

// ===== 类型 =====

export interface ChannelAlert {
  channelId: string;
  channelName: string;
  provider: string | null;
  balance: number | null;
  currency: string;
  threshold: number;
  severity: "warning" | "danger";
}

export interface SyncResult {
  synced: number;
  failed: number;
  alerts: ChannelAlert[];
}

interface ChannelRow {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  provider: string | null;
  currency: string;
  balance: number | null;
  balanceCurrency: string | null;
  balanceSyncMode: string | null;
  balanceSyncedAt: Date | null;
  balanceAlertThreshold: number | null;
  accessKeyId: string | null;
  accessKeySecret: string | null;
}

// ===== 默认阈值 =====
const DEFAULT_THRESHOLDS: Record<string, number> = {
  CNY: 100,
  USD: 10,
};

/** 判断供应商是否支持自动同步 */
function isAutoProvider(provider: string | null): boolean {
  return provider === "deepseek" || provider === "siliconflow" || provider === "alibaba";
}

/** 获取渠道的余额币种 */
function getBalanceCurrency(ch: ChannelRow): string {
  return ch.balanceCurrency || ch.currency || "CNY";
}

/** 获取渠道的预警阈值 */
function getAlertThreshold(ch: ChannelRow): number {
  if (ch.balanceAlertThreshold != null) return ch.balanceAlertThreshold;
  const currency = getBalanceCurrency(ch);
  return DEFAULT_THRESHOLDS[currency] ?? 100;
}

// ===== 余额获取 =====

/** DeepSeek 余额获取 */
async function fetchDeepSeekBalance(baseUrl: string, apiKey: string): Promise<{ balance: number; currency: string } | null> {
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/user/balance`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.error(`[BalanceSync] DeepSeek 余额获取失败: HTTP ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    // DeepSeek 返回格式: { balance_infos: [{ total_balance: "123.45", currency: "CNY", ... }] }
    const info = data?.balance_infos?.[0];
    if (!info) return null;
    return {
      balance: parseFloat(info.total_balance) || 0,
      currency: info.currency || "CNY",
    };
  } catch (err) {
    console.error(`[BalanceSync] DeepSeek 余额获取异常:`, err);
    return null;
  }
}

/** 硅基流动余额获取 */
async function fetchSiliconFlowBalance(baseUrl: string, apiKey: string): Promise<{ balance: number; currency: string } | null> {
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/v1/user/info`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.error(`[BalanceSync] SiliconFlow 余额获取失败: HTTP ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    // SiliconFlow 返回格式: { data: { totalBalance: "123.45", ... } }
    const totalBalance = data?.data?.totalBalance;
    if (totalBalance == null) return null;
    return {
      balance: parseFloat(totalBalance) || 0,
      currency: "CNY", // 硅基流动默认人民币
    };
  } catch (err) {
    console.error(`[BalanceSync] SiliconFlow 余额获取异常:`, err);
    return null;
  }
}

/**
 * 阿里云 BSS 余额获取
 *
 * 调用阿里云 BssOpenApi 的 QueryAccountBalance 接口
 * 文档: https://help.aliyun.com/document_detail/87274.html
 *
 * 签名方式: HMAC-SHA1 (RPC 风格)
 * 返回 AvailableAmount (人民币余额)
 */
async function fetchAlibabaBalance(accessKeyId: string, accessKeySecret: string): Promise<{ balance: number; currency: string } | null> {
  try {
    // 1. 构造公共参数
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); // ISO 8601
    const nonce = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

    const params: Record<string, string> = {
      Action: "QueryAccountBalance",
      Format: "JSON",
      Version: "2017-12-14",
      AccessKeyId: accessKeyId,
      SignatureMethod: "HMAC-SHA1",
      SignatureVersion: "1.0",
      SignatureNonce: nonce,
      Timestamp: timestamp,
    };

    // 2. 按 key 排序，构造 CanonicalizedQueryString
    const sortedKeys = Object.keys(params).sort();
    const canonicalizedQueryString = sortedKeys
      .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join("&");

    // 3. 构造 StringToSign
    const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonicalizedQueryString)}`;

    // 4. HMAC-SHA1 签名
    const signature = createHmac("sha1", accessKeySecret + "&")
      .update(stringToSign)
      .digest("base64");

    // 5. 拼接最终 URL
    const url = `https://business.aliyuncs.com/?${canonicalizedQueryString}&Signature=${percentEncode(signature)}`;

    // 6. 发起请求
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[BalanceSync] Alibaba BSS 余额获取失败: HTTP ${resp.status} ${text}`);
      return null;
    }

    const data = await resp.json();

    // 检查阿里云 API 错误码
    if (data.Code) {
      console.error(`[BalanceSync] Alibaba BSS API 错误: ${data.Code} - ${data.Message}`);
      return null;
    }

    // 返回格式: { Data: { AvailableAmount: "123.45", ... } }
    const amount = data?.Data?.AvailableAmount;
    if (amount == null) {
      console.error(`[BalanceSync] Alibaba BSS 返回数据异常:`, JSON.stringify(data));
      return null;
    }

    return {
      balance: parseFloat(amount) || 0,
      currency: "CNY",
    };
  } catch (err) {
    console.error(`[BalanceSync] Alibaba BSS 余额获取异常:`, err);
    return null;
  }
}

/**
 * 阿里云 RPC 签名用的 percentEncode
 * RFC 3986 编码: 除了 A-Z a-z 0-9 和 - _ . ~ 以外都编码
 */
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A")
    .replace(/~/g, "%7E");
}

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

    // 解密密钥后使用
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
      // 更新数据库
      await db.update(channels).set({
        balance: result.balance,
        balanceCurrency: result.currency,
        balanceSyncedAt: new Date(),
      }).where(eq(channels.id, ch.id));

      synced++;
      console.log(`[BalanceSync] ${ch.name} (${ch.provider}): ${result.currency === "CNY" ? "¥" : "$"}${result.balance.toFixed(2)}`);

      // 检查阈值
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

/**
 * 获取所有渠道余额概览（供 overview API 使用）
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
