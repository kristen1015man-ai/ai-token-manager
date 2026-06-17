interface InternalUser {
  id: string;
  name: string;
  role: string;
  departmentId: string | null;
  department: string | null;
  monthlyQuota: number;
}

export interface InternalChannel {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
}

interface QuotaCheckResult {
  ok: boolean;
  message?: string;
  type?: string;
  quotaInfo?: Record<string, unknown>;
  reservationId?: string;
  estimatedCost?: number;
}

export interface QuotaReservationInput {
  channelId: string;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  cachedTokens?: number;
}

function getWebUrl(): string {
  return (process.env.WEB_URL || "http://web:3000").replace(/\/+$/, "");
}

function getInternalKey(): string {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) {
    throw new Error("INTERNAL_API_KEY is required for proxy↔web communication");
  }
  return key;
}

async function internalFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${getInternalKey()}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${getWebUrl()}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });
}

export async function authenticateApiKey(apiKey: string): Promise<InternalUser | null> {
  const res = await internalFetch("/api/internal/proxy/authenticate", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`Internal auth failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json() as { user?: InternalUser };
  return data.user ?? null;
}

export async function loadChannels(model?: string): Promise<{ channels: InternalChannel[]; models: string[] }> {
  const query = model ? `?model=${encodeURIComponent(model)}` : "";
  const res = await internalFetch(`/api/internal/proxy/channels${query}`);
  if (!res.ok) {
    throw new Error(`Internal channel lookup failed: ${res.status} ${await res.text()}`);
  }
  return await res.json() as { channels: InternalChannel[]; models: string[] };
}

export async function checkUserQuota(
  userId: string,
  reservation?: QuotaReservationInput
): Promise<QuotaCheckResult> {
  const res = await internalFetch("/api/internal/proxy/quota/check", {
    method: "POST",
    body: JSON.stringify({ userId, ...(reservation || {}) }),
  });
  const data = await res.json().catch(() => ({})) as QuotaCheckResult & { error?: string };
  if (res.ok) return data;
  return {
    ok: false,
    message: data.message || data.error || "Quota check failed",
    type: data.type || (res.status === 401 ? "auth_error" : "quota_exceeded"),
    quotaInfo: data.quotaInfo,
  };
}

export async function releaseQuotaReservation(reservationId?: string | null): Promise<void> {
  if (!reservationId) return;
  try {
    const res = await internalFetch("/api/internal/proxy/quota/release", {
      method: "POST",
      body: JSON.stringify({ reservationId }),
    });
    if (!res.ok) {
      console.error(`[Quota] Failed to release reservation ${reservationId}: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[Quota] Release reservation ${reservationId} failed:`, err);
  }
}

export function getProxyHealth() {
  return {
    webUrl: getWebUrl(),
    internalKeyConfigured: Boolean(process.env.INTERNAL_API_KEY),
  };
}

export async function checkWebHealth(): Promise<{ ok: boolean; status?: number; detail?: unknown }> {
  try {
    const headers = new Headers();
    const internalKey = process.env.INTERNAL_API_KEY;
    if (internalKey) {
      headers.set("Authorization", `Bearer ${internalKey}`);
    }
    const res = await fetch(`${getWebUrl()}/api/health`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    const detail = await res.json().catch(() => undefined);
    return { ok: res.ok, status: res.status, detail };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "unknown",
    };
  }
}
