import { randomBytes } from "crypto";
import { getDb, saveDb, scheduleSave } from "./db";
import { channels, usageLogs, quotaRules, users, modelPrices } from "../../../shared/schema";
import { eq } from "drizzle-orm";
import { ensureDecrypted, safeEqual } from "./crypto";

// ========== 定价表（从数据库读取，60秒缓存，渠道+模型复合键） ==========

const FALLBACK_PRICES: Record<string, { input: number; output: number; cache: number }> = {
  "deepseek-chat": { input: 1.0, output: 2.0, cache: 0.1 },
  "deepseek-reasoner": { input: 4.0, output: 16.0, cache: 0.4 },
};

// key 格式："channelId:model" 或 ":model"（全局价格）
let priceCache: Map<string, { input: number; output: number; cache: number }> | null = null;
let cacheExpireAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadPriceTable(): Promise<Map<string, { input: number; output: number; cache: number }>> {
  const now = Date.now();
  if (priceCache && now < cacheExpireAt) return priceCache;

  try {
    const { db } = await getDb();
    const rows = await db.select().from(modelPrices);
    const map = new Map<string, { input: number; output: number; cache: number }>();
    for (const row of rows) {
      const key = `${row.channelId ?? ""}:${row.model}`;
      map.set(key, {
        input: row.inputPerMillion,
        output: row.outputPerMillion,
        cache: row.cachePerMillion,
      });
    }
    priceCache = map;
    cacheExpireAt = now + CACHE_TTL_MS;
    return map;
  } catch (err) {
    console.error("[Proxy] 加载价格表失败，使用 fallback:", err);
    const map = new Map<string, { input: number; output: number; cache: number }>();
    for (const [model, price] of Object.entries(FALLBACK_PRICES)) {
      map.set(`:${model}`, price);
    }
    priceCache = map;
    cacheExpireAt = now + CACHE_TTL_MS;
    return map;
  }
}

/** 手动清除价格缓存（管理后台修改价格后调用） */
export function invalidatePriceCache(): void {
  priceCache = null;
  cacheExpireAt = 0;
}

// ========== 渠道缓存（30秒 TTL） ==========

let channelCache: ChannelInfo[] | null = null;
let channelCacheExpireAt = 0;
const CHANNEL_CACHE_TTL_MS = 30_000;

async function loadActiveChannels(): Promise<ChannelInfo[]> {
  const now = Date.now();
  if (channelCache && now < channelCacheExpireAt) return channelCache;

  const { db } = await getDb();
  const result = await db.select().from(channels).where(eq(channels.status, "active")).orderBy(channels.priority);
  channelCache = result.map((ch) => ({
    id: ch.id,
    name: ch.name,
    baseUrl: ch.baseUrl,
    apiKey: ensureDecrypted(ch.apiKey),
    models: (typeof ch.models === "string" ? JSON.parse(ch.models) : ch.models) as string[],
    priority: ch.priority,
  }));
  channelCacheExpireAt = now + CHANNEL_CACHE_TTL_MS;
  return channelCache;
}

/** 清除渠道缓存（管理后台修改渠道后调用） */
export function invalidateChannelCache(): void {
  channelCache = null;
  channelCacheExpireAt = 0;
}

// ========== 限额规则缓存（30秒 TTL） ==========

let quotaCache: { rules: Awaited<ReturnType<typeof import("drizzle-orm").eq> extends never ? never : any> } | null = null;
let quotaCacheExpireAt = 0;
const QUOTA_CACHE_TTL_MS = 30_000;

async function loadQuotaRules(): Promise<any[]> {
  const now = Date.now();
  if (quotaCache && now < quotaCacheExpireAt) return quotaCache.rules;

  const { db } = await getDb();
  const rules = await db.select().from(quotaRules);
  quotaCache = { rules };
  quotaCacheExpireAt = now + QUOTA_CACHE_TTL_MS;
  return rules;
}

/** 清除限额缓存（管理后台修改额度后调用） */
export function invalidateQuotaCache(): void {
  quotaCache = null;
  quotaCacheExpireAt = 0;
}

/**
 * 计算单次请求费用
 * 三级查找链：(channelId, model) → (NULL, model) → 硬编码兜底
 */
async function calculateCost(channelId: string, model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): Promise<number> {
  const prices = await loadPriceTable();

  // 第一级：渠道专属价格
  let price = prices.get(`${channelId}:${model}`);

  if (!price) {
    // 第二级：全局价格
    price = prices.get(`:${model}`);
  }

  if (!price) {
    // 第三级：硬编码兜底
    price = prices.get(`:deepseek-chat`) || FALLBACK_PRICES["deepseek-chat"];
  }

  const nonCached = Math.max(0, inputTokens - cachedTokens);
  return (nonCached * price.input + cachedTokens * price.cache + outputTokens * price.output) / 1_000_000;
}

// ========== API Key 认证 ==========

export async function authenticateUser(apiKey: string) {
  if (!apiKey.startsWith("sk-")) return null;

  // apiKey 可能已加密存储，无法直接 SQL 匹配，需加载所有用户后内存比对
  const { db } = await getDb();
  const allUsers = await db.select().from(users);

  for (const user of allUsers) {
    const decryptedKey = ensureDecrypted(user.apiKey);
    if (safeEqual(decryptedKey, apiKey)) {
      if (user.status === "disabled") return null;
      return user;
    }
  }
  return null;
}

// ========== 限额检查 ==========

function monthStart(): number {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
}

export async function checkQuota(userId: string): Promise<{ ok: boolean; message?: string }> {
  const { db, sqlite } = await getDb();
  const dbAny = sqlite as any;
  const ms = monthStart();

  const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (userResult.length === 0) return { ok: false, message: "用户不存在" };
  const user = userResult[0];

  const rules = await loadQuotaRules();
  const getUsed = (sql: string, params: unknown[]) => {
    const r = dbAny.exec(sql, params);
    return Number(r[0]?.values[0]?.[0] ?? 0);
  };

  // 个人限额
  const personalRule = rules.find((r) => r.scope === "personal" && r.targetId === userId);
  if (personalRule) {
    const used = getUsed(`SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE user_id = ? AND created_at >= ?`, [userId, ms]);
    if (used >= personalRule.monthlyLimit) {
      return { ok: false, message: `本月额度已用完（${used.toFixed(2)}/${personalRule.monthlyLimit.toFixed(2)}元）` };
    }
  }

  // 部门限额
  if (user.departmentId) {
    const deptRule = rules.find((r) => r.scope === "department" && r.targetId === user.departmentId);
    if (deptRule) {
      const used = getUsed(
        `SELECT COALESCE(SUM(ul.cost), 0) FROM usage_logs ul JOIN users u ON ul.user_id = u.id WHERE u.department_id = ? AND ul.created_at >= ?`,
        [user.departmentId, ms]
      );
      if (used >= deptRule.monthlyLimit) {
        return { ok: false, message: `部门本月预算已用完（${used.toFixed(2)}/${deptRule.monthlyLimit.toFixed(2)}元）` };
      }
    }
  }

  // 公司限额
  const companyRule = rules.find((r) => r.scope === "company");
  if (companyRule) {
    const used = getUsed(`SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE created_at >= ?`, [ms]);
    if (used >= companyRule.monthlyLimit) {
      return { ok: false, message: `公司本月AI预算已用完（${used.toFixed(2)}/${companyRule.monthlyLimit.toFixed(2)}元）` };
    }
  }

  return { ok: true };
}

// ========== 渠道查找 ==========

interface ChannelInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
}

async function findChannelForModel(model: string): Promise<ChannelInfo | null> {
  const channelList = await loadActiveChannels();
  for (const ch of channelList) {
    if (ch.models.includes(model) || ch.models.includes("*")) {
      return ch;
    }
  }
  return null;
}

async function findFallbackChannel(model: string, excludeId: string): Promise<ChannelInfo | null> {
  const channelList = await loadActiveChannels();
  let found = false;
  for (const ch of channelList) {
    if (ch.id === excludeId) { found = true; continue; }
    if (!found) continue;
    if (ch.models.includes(model) || ch.models.includes("*")) {
      return ch;
    }
  }
  return null;
}

export async function getAvailableModels(): Promise<string[]> {
  const channelList = await loadActiveChannels();
  const modelSet = new Set<string>();
  for (const ch of channelList) {
    for (const m of ch.models) { if (m !== "*") modelSet.add(m); }
  }
  return Array.from(modelSet);
}

// ========== 用量记录 ==========

interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

async function extractUsage(responseBody: Record<string, unknown>, channelId: string, model: string): Promise<UsageRecord> {
  const usage = responseBody.usage as {
    prompt_tokens?: number; completion_tokens?: number; total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | undefined;

  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const cost = await calculateCost(channelId, model, inputTokens, outputTokens, cachedTokens);

  return { inputTokens, outputTokens, totalTokens, cost };
}

async function recordUsage(userId: string, model: string, channelId: string, usage: UsageRecord) {
  if (usage.totalTokens === 0) return;
  try {
    const { db } = await getDb();
    await db.insert(usageLogs).values({
      id: `log_${randomBytes(8).toString("hex")}`,
      userId, model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cost: usage.cost,
      channelId,
      createdAt: new Date(),
    });
    scheduleSave(); // 延迟批量写入，避免每次请求都落盘
  } catch (err) {
    console.error("[Proxy] 记录用量失败:", err);
  }
}

// ========== 上游请求 ==========

const UPSTREAM_TIMEOUT = 30_000;

async function sendUpstream(channel: ChannelInfo, body: string, stream?: boolean): Promise<Response> {
  const url = `${channel.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${channel.apiKey}`,
  };
  if (stream) headers["Accept"] = "text/event-stream";

  const resp = await fetch(url, {
    method: "POST", headers, body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`上游返回 ${resp.status}: ${errorText.slice(0, 200)}`);
  }
  return resp;
}

// ========== 主代理函数 ==========

export async function proxyChatRequest(
  userId: string,
  requestBody: { model: string; stream?: boolean; [key: string]: unknown }
): Promise<Response> {
  const { model, stream, ...restBody } = requestBody;

  // 查找渠道
  let channel = await findChannelForModel(model);
  if (!channel) {
    return Response.json(
      { error: { message: `模型 '${model}' 没有可用渠道，请在管理后台配置`, type: "no_channel" } },
      { status: 404 }
    );
  }

  const upstreamBody = JSON.stringify({ model, stream, ...restBody });
  let response: Response;
  let usedChannel = channel;

  // 发送请求（含故障切换）
  try {
    response = await sendUpstream(channel, upstreamBody, stream);
  } catch (err) {
    console.error(`[Proxy] 渠道 ${channel.name} 失败:`, err);
    const fallback = await findFallbackChannel(model, channel.id);
    if (!fallback) {
      return Response.json(
        { error: { message: `模型 '${model}' 所有渠道均不可用`, type: "upstream_error" } },
        { status: 502 }
      );
    }
    usedChannel = fallback;
    try {
      response = await sendUpstream(fallback, upstreamBody, stream);
    } catch {
      return Response.json(
        { error: { message: "上游请求失败：所有渠道不可用", type: "upstream_error" } },
        { status: 502 }
      );
    }
  }

  // 处理响应
  if (stream) {
    return handleStreamResponse(response, userId, model, usedChannel.id);
  } else {
    return handleNonStreamResponse(response, userId, model, usedChannel.id);
  }
}

// ========== 非流式响应 ==========

async function handleNonStreamResponse(
  upstreamResponse: Response, userId: string, model: string, channelId: string
): Promise<Response> {
  const bodyText = await upstreamResponse.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return new Response(bodyText, {
      status: upstreamResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 提取用量并记录（传入 channelId 用于渠道定价查找）
  const usage = await extractUsage(parsed, channelId, model);
  await recordUsage(userId, model, channelId, usage);

  return new Response(JSON.stringify(parsed), {
    status: upstreamResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

// ========== 流式响应（SSE） ==========

function handleStreamResponse(
  upstreamResponse: Response, userId: string, model: string, channelId: string
): Response {
  const reader = upstreamResponse.body?.getReader();
  if (!reader) {
    return Response.json({ error: { message: "上游无响应体", type: "stream_error" } }, { status: 502 });
  }

  let lastUsage: UsageRecord | null = null;
  let buffer = "";

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (lastUsage) await recordUsage(userId, model, channelId, lastUsage);
          controller.close();
          return;
        }

        controller.enqueue(value);

        // 从 SSE 行中提取 usage
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.usage) lastUsage = await extractUsage(parsed, channelId, model);
            } catch { /* 忽略非 JSON 行 */ }
          }
        }
      } catch (err) {
        console.error("[Proxy] 流读取错误:", err);
        if (lastUsage) await recordUsage(userId, model, channelId, lastUsage);
        controller.error(err);
      }
    },
    cancel() {
      // 客户端断开，记录已收集的用量
      if (lastUsage) {
        recordUsage(userId, model, channelId, lastUsage).catch((err) =>
          console.error("[Proxy] Stream cancel 用量记录失败:", err)
        );
      }
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ========== 限频（内存滑动窗口） ==========

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(userId: string, maxPerMinute = 60): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  entry.count++;
  if (entry.count > maxPerMinute) return false;
  return true;
}
