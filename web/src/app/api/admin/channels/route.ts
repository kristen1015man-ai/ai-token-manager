import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";
import { channels } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";
import { ensureEncrypted, ensureDecrypted, isEncrypted } from "../../../../lib/crypto";
import { auditLog } from "../../../../lib/audit-log";
import { apiHandler } from "../../../../lib/api-handler";
import { inferAutoProvider } from "../../../../lib/balance-fetchers";
import { isMaskedSecret, secretStatus, validateProviderApiKey } from "../../../../lib/provider-secrets";
import { assertSafeUpstreamBaseUrl } from "../../../../lib/upstream-safety";

const CHANNEL_STATUSES = new Set(["active", "disabled"]);
const BALANCE_SYNC_MODES = new Set(["auto", "manual"]);

function normalizeSecretInput(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!str || isMaskedSecret(str)) return null;
  if (isEncrypted(str)) {
    throw new Error("Secret must be plaintext, not encrypted storage value");
  }
  return str;
}

function parseModels(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((m) => typeof m === "string" && m.trim())) {
    return value.map((m) => m.trim());
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parseModels(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function parseOptionalNonNegative(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
}

function inferChannelProvider(provider: unknown, baseUrl = "", name = "", id = ""): string | null {
  return inferAutoProvider(typeof provider === "string" ? provider : null, baseUrl, name, id);
}

function isPrivateIpv4(address: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
    return false;
  }
  const parts = address.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase();
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  );
}

function isUnsafeChannelHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") {
    return true;
  }
  return isPrivateIpv4(host) || isPrivateIpv6(host);
}

function parseChannelStatus(value: unknown, fallback: "active" | "disabled"): "active" | "disabled" | null {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim();
  return CHANNEL_STATUSES.has(normalized) ? normalized as "active" | "disabled" : null;
}

function parseBalanceSyncMode(value: unknown): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || String(value).trim() === "") return { ok: true, value: null };
  const normalized = String(value).trim();
  if (!BALANCE_SYNC_MODES.has(normalized)) {
    return { ok: false, error: "balanceSyncMode must be auto, manual, or empty" };
  }
  return { ok: true, value: normalized };
}

async function validateChannelBaseUrl(value: unknown): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(String(value));
  } catch {
    return "baseUrl must be a valid URL";
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    return "baseUrl protocol must be https";
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    return "baseUrl must use https in production";
  }
  if (parsed.username || parsed.password) {
    return "baseUrl must not contain credentials";
  }
  if (isUnsafeChannelHost(parsed.hostname)) {
    return "baseUrl must not point to localhost, metadata, or private network addresses";
  }
  try {
    await assertSafeUpstreamBaseUrl(String(value));
  } catch (err) {
    return err instanceof Error ? err.message : "baseUrl failed upstream safety validation";
  }
  return null;
}

function secretDisplay(value: string | null | undefined, provider: string | null | undefined, visible = 8) {
  if (!value) {
    return { display: null, status: "not_configured" as const, warning: "API Key 未配置" };
  }
  const decrypted = ensureDecrypted(value);
  if (isEncrypted(value) && decrypted === value) {
    return { display: "无法解密，请重新录入", status: "unreadable" as const, warning: "API Key 无法解密，请重新录入" };
  }
  const status = secretStatus(provider, decrypted);
  if (status.status !== "ok") {
    return { display: "疑似无效，请重新录入", status: status.status, warning: status.warning };
  }
  return { display: decrypted.slice(0, visible) + "****", status: "ok" as const, warning: null };
}

export const GET = apiHandler(async (request: NextRequest) => {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const isSummary = request.nextUrl.searchParams.get("summary") === "1";
  if (isSummary) {
    const summary = await db.select({
      id: channels.id,
      name: channels.name,
      currency: channels.currency,
      provider: channels.provider,
      status: channels.status,
      priority: channels.priority,
    }).from(channels).orderBy(channels.priority);
    return NextResponse.json({ channels: summary });
  }
  const list = await db.select().from(channels).orderBy(channels.priority);

  return NextResponse.json({
    channels: list.map((ch) => {
      const inferredProvider = inferChannelProvider(ch.provider, ch.baseUrl, ch.name, ch.id);
      const apiKey = secretDisplay(ch.apiKey, inferredProvider);
      const accessKeySecret = secretDisplay(ch.accessKeySecret, inferredProvider, 4);
      return {
        ...ch,
        provider: inferredProvider,
        apiKey: apiKey.display,
        apiKeyStatus: apiKey.status,
        apiKeyWarning: apiKey.warning,
        accessKeySecret: accessKeySecret.display,
        accessKeySecretStatus: accessKeySecret.status,
        accessKeySecretWarning: accessKeySecret.warning,
      };
    }),
  });
});

export const POST = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const body = await request.json();
  const { name, baseUrl, apiKey, models, priority, status, currency, provider, balanceSyncMode, balanceAlertThreshold } = body;

  if (!name || !baseUrl || !apiKey || !models) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const baseUrlError = await validateChannelBaseUrl(baseUrl);
  if (baseUrlError) {
    return NextResponse.json({ error: baseUrlError }, { status: 400 });
  }
  const parsedStatus = parseChannelStatus(status, "active");
  if (!parsedStatus) {
    return NextResponse.json({ error: "status must be active or disabled" }, { status: 400 });
  }
  const parsedBalanceSyncMode = parseBalanceSyncMode(balanceSyncMode);
  if (!parsedBalanceSyncMode.ok) {
    return NextResponse.json({ error: parsedBalanceSyncMode.error }, { status: 400 });
  }
  const parsedModels = parseModels(models);
  if (!parsedModels) {
    return NextResponse.json({ error: "models must be a JSON string array" }, { status: 400 });
  }
  const parsedPriority = Number(priority ?? 0);
  if (!Number.isInteger(parsedPriority) || parsedPriority < 0) {
    return NextResponse.json({ error: "priority must be a non-negative integer" }, { status: 400 });
  }
  const parsedBalanceAlertThreshold = parseOptionalNonNegative(balanceAlertThreshold);
  if (Number.isNaN(parsedBalanceAlertThreshold)) {
    return NextResponse.json({ error: "balanceAlertThreshold must be a non-negative number" }, { status: 400 });
  }
  const inferredProvider = inferChannelProvider(provider ?? null, baseUrl, name);
  const apiKeyWarning = validateProviderApiKey(inferredProvider, String(apiKey));
  if (apiKeyWarning) {
    return NextResponse.json({ error: apiKeyWarning }, { status: 400 });
  }

  const { db } = await getDb();
  const channelId = randomBytes(8).toString("hex");
  await db.insert(channels).values({
    id: channelId,
    name,
    baseUrl,
    apiKey: ensureEncrypted(apiKey),
    models: parsedModels,
    priority: parsedPriority,
    status: parsedStatus,
    currency: currency ?? "CNY",
    provider: inferredProvider,
    balanceSyncMode: parsedBalanceSyncMode.value ?? null,
    balanceAlertThreshold: parsedBalanceAlertThreshold,
    createdAt: new Date(),
  });

  await saveDb();
  await auditLog(session.userId, "create", "channel", channelId, { name, provider: inferredProvider, baseUrl });
  return NextResponse.json({ success: true });
});

export const PUT = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const body = await request.json();
  const { id, name, baseUrl, apiKey, models, priority, status, currency, provider,
          balance, balanceCurrency, balanceSyncMode, balanceAlertThreshold,
          accessKeyId, accessKeySecret } = body;

  if (!id) {
    return NextResponse.json({ error: "Missing channel id" }, { status: 400 });
  }

  const { db } = await getDb();
  const existingRows = await db.select().from(channels).where(eq(channels.id, id)).limit(1);
  if (existingRows.length === 0) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }
  const existing = existingRows[0];
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (baseUrl !== undefined) {
    const baseUrlError = await validateChannelBaseUrl(baseUrl);
    if (baseUrlError) {
      return NextResponse.json({ error: baseUrlError }, { status: 400 });
    }
    updateData.baseUrl = baseUrl;
  }
  const nextName = name !== undefined ? String(name) : existing.name;
  const nextBaseUrl = baseUrl !== undefined ? String(baseUrl) : existing.baseUrl;
  const requestedProvider = provider !== undefined ? provider : existing.provider;
  const inferredProvider = inferChannelProvider(requestedProvider, nextBaseUrl, nextName, id);
  const parsedBalanceSyncMode = parseBalanceSyncMode(balanceSyncMode);
  if (!parsedBalanceSyncMode.ok) {
    return NextResponse.json({ error: parsedBalanceSyncMode.error }, { status: 400 });
  }
  const nextBalanceSyncMode = parsedBalanceSyncMode.value !== undefined ? parsedBalanceSyncMode.value : existing.balanceSyncMode;
  let apiKeyChanged = false;
  try {
    const normalizedApiKey = normalizeSecretInput(apiKey);
    if (normalizedApiKey) {
      const apiKeyWarning = validateProviderApiKey(inferredProvider, normalizedApiKey);
      if (apiKeyWarning) {
        return NextResponse.json({ error: apiKeyWarning }, { status: 400 });
      }
      updateData.apiKey = ensureEncrypted(normalizedApiKey);
      updateData.balance = null;
      updateData.balanceCurrency = null;
      updateData.balanceSyncedAt = null;
      apiKeyChanged = true;
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid API key" }, { status: 400 });
  }
  if (models !== undefined) {
    const parsedModels = parseModels(models);
    if (!parsedModels) return NextResponse.json({ error: "models must be a JSON string array" }, { status: 400 });
    updateData.models = parsedModels;
  }
  if (priority !== undefined) {
    const parsedPriority = Number(priority);
    if (!Number.isInteger(parsedPriority) || parsedPriority < 0) {
      return NextResponse.json({ error: "priority must be a non-negative integer" }, { status: 400 });
    }
    updateData.priority = parsedPriority;
  }
  if (status !== undefined) {
    const parsedStatus = parseChannelStatus(status, existing.status === "disabled" ? "disabled" : "active");
    if (!parsedStatus) {
      return NextResponse.json({ error: "status must be active or disabled" }, { status: 400 });
    }
    updateData.status = parsedStatus;
  }
  if (currency !== undefined) updateData.currency = currency;
  if (provider !== undefined || inferredProvider !== existing.provider) updateData.provider = inferredProvider;

  if (!apiKeyChanged && inferredProvider && nextBalanceSyncMode !== "manual") {
    const existingPlainKey = ensureDecrypted(existing.apiKey);
    const existingKeyWarning = validateProviderApiKey(inferredProvider, existingPlainKey);
    if (existingKeyWarning) {
      return NextResponse.json(
        { error: `${existingKeyWarning}。该渠道当前保存的 API Key 需要同时重新录入。` },
        { status: 400 }
      );
    }
  }

  // 余额字段更新
  if (balance !== undefined) {
    const parsedBalance = parseOptionalNonNegative(balance);
    if (Number.isNaN(parsedBalance)) {
      return NextResponse.json({ error: "balance must be a non-negative number" }, { status: 400 });
    }
    updateData.balance = parsedBalance;
    updateData.balanceSyncedAt = new Date(); // 手动设余额时自动更新同步时间
  }
  if (balanceCurrency !== undefined) updateData.balanceCurrency = balanceCurrency;
  if (balanceSyncMode !== undefined) updateData.balanceSyncMode = parsedBalanceSyncMode.value ?? null;
  if (balanceAlertThreshold !== undefined) {
    const parsedThreshold = parseOptionalNonNegative(balanceAlertThreshold);
    if (Number.isNaN(parsedThreshold)) {
      return NextResponse.json({ error: "balanceAlertThreshold must be a non-negative number" }, { status: 400 });
    }
    updateData.balanceAlertThreshold = parsedThreshold;
  }

  // 阿里云 AK/SK（Secret 加密存储）
  if (accessKeyId !== undefined) updateData.accessKeyId = accessKeyId;
  try {
    const normalizedAccessKeySecret = normalizeSecretInput(accessKeySecret);
    if (normalizedAccessKeySecret) {
      updateData.accessKeySecret = ensureEncrypted(normalizedAccessKeySecret);
      if (!apiKeyChanged) {
        updateData.balance = null;
        updateData.balanceCurrency = null;
        updateData.balanceSyncedAt = null;
      }
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid access key secret" }, { status: 400 });
  }

  await db.update(channels).set(updateData).where(eq(channels.id, id));
  await saveDb();

  await auditLog(session.userId, "update", "channel", id, { updatedFields: Object.keys(updateData) });
  return NextResponse.json({ success: true });
});

export const DELETE = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "Missing channel id" }, { status: 400 });
  }

  const { db } = await getDb();
  await db.delete(channels).where(eq(channels.id, id));
  await saveDb();

  await auditLog(session.userId, "delete", "channel", id);
  return NextResponse.json({ success: true });
});
