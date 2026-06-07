/**
 * proxy/index.ts — 认证、限额检查、渠道查找、上游请求、主代理函数、限频
 */
import { getDb, getRawExec } from "../db";
import { users } from "../../../../shared/schema";
import { eq } from "drizzle-orm";
import { ensureDecrypted, safeEqual, searchableHash } from "../crypto";
import { invalidatePriceCache, loadActiveChannels, invalidateChannelCache, loadQuotaRules, invalidateQuotaCache, type ChannelInfo } from "./cache";
import { handleStreamResponse, handleNonStreamResponse } from "./streaming";

// 重导出缓存失效函数，外部导入路径不变
export { invalidatePriceCache, invalidateChannelCache, invalidateQuotaCache };
export type { ChannelInfo } from "./cache";

// ========== API Key 认证 ==========

export async function authenticateUser(apiKey: string) {
  if (!apiKey.startsWith("sk-")) return null;

  // SEC-02: hash → SQL 精确匹配，不再全表扫描
  const { db } = await getDb();
  const hash = searchableHash(apiKey);
  const candidates = await db
    .select()
    .from(users)
    .where(eq(users.apiKeyHash, hash))
    .limit(1);

  if (candidates.length === 0) return null;

  // 二次验证：timing-safe 比对确认（防碰撞）
  const user = candidates[0];
  const decryptedKey = ensureDecrypted(user.apiKey);
  if (!safeEqual(decryptedKey, apiKey)) return null;

  if (user.status === "disabled") return null;
  return user;
}

// ========== 限额检查 ==========

function monthStart(): number {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
}

export async function checkQuota(userId: string): Promise<{ ok: boolean; message?: string }> {
  const { db, sqlite } = await getDb();
  const rawDb = getRawExec(sqlite);
  const ms = monthStart();

  const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (userResult.length === 0) return { ok: false, message: "用户不存在" };
  const user = userResult[0];

  const rules = await loadQuotaRules();
  const getUsed = (sql: string, params: unknown[]) => {
    const r = rawDb.exec(sql, params);
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
    } catch (err) {
      console.error("[Proxy] fallback 渠道上游请求失败:", err);
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
