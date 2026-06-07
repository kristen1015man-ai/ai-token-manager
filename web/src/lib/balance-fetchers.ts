/**
 * balance-fetchers.ts — 类型定义、默认阈值、各供应商余额获取实现
 */
import { createHmac } from "crypto";

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

export interface ChannelRow {
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
export const DEFAULT_THRESHOLDS: Record<string, number> = {
  CNY: 100,
  USD: 10,
};

/** 判断供应商是否支持自动同步 */
export function isAutoProvider(provider: string | null): boolean {
  return provider === "deepseek" || provider === "siliconflow" || provider === "alibaba";
}

/** 获取渠道的余额币种 */
export function getBalanceCurrency(ch: ChannelRow): string {
  return ch.balanceCurrency || ch.currency || "CNY";
}

/** 获取渠道的预警阈值 */
export function getAlertThreshold(ch: ChannelRow): number {
  if (ch.balanceAlertThreshold != null) return ch.balanceAlertThreshold;
  const currency = getBalanceCurrency(ch);
  return DEFAULT_THRESHOLDS[currency] ?? 100;
}

// ===== 余额获取 =====

/** DeepSeek 余额获取 */
export async function fetchDeepSeekBalance(baseUrl: string, apiKey: string): Promise<{ balance: number; currency: string } | null> {
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
export async function fetchSiliconFlowBalance(baseUrl: string, apiKey: string): Promise<{ balance: number; currency: string } | null> {
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
    const totalBalance = data?.data?.totalBalance;
    if (totalBalance == null) return null;
    return {
      balance: parseFloat(totalBalance) || 0,
      currency: "CNY",
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
 * 签名方式: HMAC-SHA1 (RPC 风格)
 * 返回 AvailableAmount (人民币余额)
 */
export async function fetchAlibabaBalance(accessKeyId: string, accessKeySecret: string): Promise<{ balance: number; currency: string } | null> {
  try {
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
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

    const sortedKeys = Object.keys(params).sort();
    const canonicalizedQueryString = sortedKeys
      .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join("&");

    const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonicalizedQueryString)}`;

    const signature = createHmac("sha1", accessKeySecret + "&")
      .update(stringToSign)
      .digest("base64");

    const url = `https://business.aliyuncs.com/?${canonicalizedQueryString}&Signature=${percentEncode(signature)}`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[BalanceSync] Alibaba BSS 余额获取失败: HTTP ${resp.status} ${text}`);
      return null;
    }

    const data = await resp.json();

    if (data.Code) {
      console.error(`[BalanceSync] Alibaba BSS API 错误: ${data.Code} - ${data.Message}`);
      return null;
    }

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
