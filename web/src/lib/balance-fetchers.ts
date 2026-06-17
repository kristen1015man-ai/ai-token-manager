import { createHmac } from "crypto";
import { assertSafeUpstreamBaseUrl } from "./upstream-safety";

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
  errors: Array<{
    channelId: string;
    channelName: string;
    message: string;
  }>;
}

export interface ChannelRow {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  provider: string | null;
  status: string;
  currency: string;
  balance: number | null;
  balanceCurrency: string | null;
  balanceSyncMode: string | null;
  balanceSyncedAt: Date | null;
  balanceAlertThreshold: number | null;
  accessKeyId: string | null;
  accessKeySecret: string | null;
}

export type ProviderBalanceResult =
  | { ok: true; balance: number; currency: string }
  | { ok: false; message: string };

export const DEFAULT_THRESHOLDS: Record<string, number> = {
  CNY: 100,
  USD: 10,
};

export function isAutoProvider(provider: string | null): boolean {
  return provider === "deepseek" || provider === "siliconflow" || provider === "alibaba";
}

export function inferAutoProvider(
  provider: string | null,
  baseUrl = "",
  name = "",
  id = "",
): string | null {
  const normalized = provider?.trim().toLowerCase() || "";
  if (isAutoProvider(normalized)) return normalized;

  const text = `${id} ${name} ${baseUrl}`.toLowerCase();
  if (text.includes("deepseek")) return "deepseek";
  if (text.includes("siliconflow") || text.includes("silicon")) return "siliconflow";
  if (text.includes("alibaba") || text.includes("aliyun")) return "alibaba";

  return normalized || null;
}

export function getBalanceCurrency(ch: ChannelRow): string {
  return ch.balanceCurrency || ch.currency || "CNY";
}

export function getAlertThreshold(ch: ChannelRow): number {
  if (ch.balanceAlertThreshold != null) return ch.balanceAlertThreshold;
  const currency = getBalanceCurrency(ch);
  return DEFAULT_THRESHOLDS[currency] ?? 100;
}

async function providerRoot(baseUrl: string): Promise<string> {
  const safeBaseUrl = await assertSafeUpstreamBaseUrl(baseUrl);
  safeBaseUrl.search = "";
  safeBaseUrl.hash = "";
  return safeBaseUrl.toString().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function parseFiniteBalance(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function balanceOk(balance: number, currency: string): ProviderBalanceResult {
  return { ok: true, balance, currency };
}

function balanceError(provider: string, message: string): ProviderBalanceResult {
  console.error(`[BalanceSync] ${provider}: ${message}`);
  return { ok: false, message };
}

async function readErrorText(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

export async function fetchDeepSeekBalance(baseUrl: string, apiKey: string): Promise<ProviderBalanceResult> {
  try {
    const url = `${await providerRoot(baseUrl)}/user/balance`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const detail = await readErrorText(resp);
      const message = resp.status === 401 || resp.status === 403
        ? "供应商拒绝认证，请重新录入 DeepSeek 控制台生成的完整 API Key"
        : `DeepSeek 余额接口返回 HTTP ${resp.status}`;
      return balanceError("DeepSeek", detail ? `${message} (${detail})` : message);
    }

    const data = await resp.json();
    const info = data?.balance_infos?.[0];
    if (!info) return balanceError("DeepSeek", "余额接口返回缺少 balance_infos");

    const balance = parseFiniteBalance(info.total_balance);
    if (balance === null) return balanceError("DeepSeek", "余额接口返回的 total_balance 不是有效数字");

    return balanceOk(balance, info.currency || "CNY");
  } catch (err) {
    return balanceError("DeepSeek", `无法连接余额接口，请检查 Base URL 和网络：${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function fetchSiliconFlowBalance(baseUrl: string, apiKey: string): Promise<ProviderBalanceResult> {
  try {
    const url = `${await providerRoot(baseUrl)}/v1/user/info`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const detail = await readErrorText(resp);
      const message = resp.status === 401 || resp.status === 403
        ? "供应商拒绝认证，请重新录入硅基流动控制台生成的完整 API Key"
        : `硅基流动余额接口返回 HTTP ${resp.status}`;
      return balanceError("SiliconFlow", detail ? `${message} (${detail})` : message);
    }

    const data = await resp.json();
    if (data?.code && data.code !== 20000 && data.code !== 0) {
      return balanceError("SiliconFlow", `硅基流动 API 返回错误：code=${data.code}, message=${data.message || data.msg || ""}`);
    }

    const info = data?.data ?? data;
    const availableBalance = parseFiniteBalance(info?.availableBalance);
    const totalBalance = parseFiniteBalance(info?.totalBalance);
    const chargeBalance = parseFiniteBalance(info?.chargeBalance);
    const balance = parseFiniteBalance(info?.balance);
    const positiveCashBalance = [availableBalance, chargeBalance, balance, totalBalance]
      .find((value) => value !== null && value >= 0);
    const effectiveBalance = positiveCashBalance
      ?? totalBalance
      ?? chargeBalance
      ?? balance
      ?? availableBalance;

    if (effectiveBalance === null) {
      return balanceError("SiliconFlow", "余额接口返回缺少 availableBalance/chargeBalance/balance/totalBalance 字段");
    }

    return balanceOk(effectiveBalance, "CNY");
  } catch (err) {
    return balanceError("SiliconFlow", `无法连接余额接口，请检查 Base URL 和网络：${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function fetchAlibabaBalance(accessKeyId: string, accessKeySecret: string): Promise<ProviderBalanceResult> {
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
      .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
      .join("&");

    const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonicalizedQueryString)}`;
    const signature = createHmac("sha1", `${accessKeySecret}&`).update(stringToSign).digest("base64");
    const url = `https://business.aliyuncs.com/?${canonicalizedQueryString}&Signature=${percentEncode(signature)}`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
    });

    if (!resp.ok) {
      const text = await readErrorText(resp);
      return balanceError("Alibaba", `BSS 余额接口返回 HTTP ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    if (data.Code) {
      return balanceError("Alibaba", `BSS API 返回错误：${data.Code} - ${data.Message}`);
    }

    const amount = data?.Data?.AvailableAmount;
    if (amount == null) {
      return balanceError("Alibaba", `BSS 返回缺少 AvailableAmount: ${JSON.stringify(data).slice(0, 300)}`);
    }

    const balance = parseFiniteBalance(amount);
    if (balance === null) {
      return balanceError("Alibaba", `BSS AvailableAmount 不是有效数字: ${String(amount).slice(0, 80)}`);
    }

    return balanceOk(balance, "CNY");
  } catch (err) {
    return balanceError("Alibaba", `无法连接 BSS 余额接口：${err instanceof Error ? err.message : String(err)}`);
  }
}

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A")
    .replace(/~/g, "%7E");
}
