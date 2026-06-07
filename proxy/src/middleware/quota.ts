import { createMiddleware } from "hono/factory";
import { getDb } from "../../../shared/db.js";
import { quotaRules } from "../../../shared/schema.js";

/** sql.js exec() 的最小类型接口（TypeScript 类型定义未声明但运行时存在） */
interface SqliteExec {
  exec(sql: string, params?: unknown[]): { columns: string[]; values: unknown[][] }[];
}

function monthStart(): number {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
}

// ========== DB-04: 限额查询缓存（60s TTL） ==========
const CACHE_TTL_MS = 60_000;

interface QuotaCacheEntry {
  rules: typeof quotaRules.$inferSelect[];
  userMap: Map<string, { departmentId: string | null }>;
  fetchedAt: number;
}

let quotaCache: QuotaCacheEntry | null = null;

/** 获取缓存或重新查询 quota_rules + 用户信息 */
async function getQuotaCache(): Promise<QuotaCacheEntry> {
  if (quotaCache && Date.now() - quotaCache.fetchedAt < CACHE_TTL_MS) {
    return quotaCache;
  }

  const { db, sqlite } = await getDb();
  const rules = await db.select().from(quotaRules);
  const dbRaw = sqlite as unknown as SqliteExec;

  // 一次性查出所有用户的 id + department_id，构建 Map
  const userRows = dbRaw.exec(`SELECT id, department_id FROM users`);
  const userMap = new Map<string, { departmentId: string | null }>();
  if (userRows[0]) {
    for (const row of userRows[0].values) {
      userMap.set(String(row[0]), { departmentId: row[1] ? String(row[1]) : null });
    }
  }

  quotaCache = { rules, userMap, fetchedAt: Date.now() };
  return quotaCache;
}

/** 月度用量查询缓存（按 scope 维度，60s TTL） */
const usageCache = new Map<string, { value: number; fetchedAt: number }>();

function getCachedUsage(key: string): number | null {
  const entry = usageCache.get(key);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.value;
  }
  return null;
}

function setCachedUsage(key: string, value: number): void {
  usageCache.set(key, { value, fetchedAt: Date.now() });
  // 防止缓存无限增长
  if (usageCache.size > 100) {
    const oldest = [...usageCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    for (let i = 0; i < 20; i++) usageCache.delete(oldest[i][0]);
  }
}

// ========== 阈值预警：fire-and-forget 发送到 web ==========

interface PendingAlert {
  type: "personal_80" | "personal_100" | "dept_80" | "company_90";
  targetId: string;
  userId: string;
  used: number;
  limit: number;
  percent: number;
}

/** 当前月份字符串（格式 "2026-06"） */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** 缓存管理员名称（用于 quota_info.adminContact） */
let cachedAdminContact: string | null = null;
let adminContactFetchedAt = 0;

async function getAdminContact(): Promise<string> {
  if (cachedAdminContact && Date.now() - adminContactFetchedAt < CACHE_TTL_MS) {
    return cachedAdminContact;
  }
  try {
    const { sqlite } = await getDb();
    const dbRaw = sqlite as unknown as SqliteExec;
    const rows = dbRaw.exec(
      `SELECT name FROM users WHERE role LIKE '%admin%' AND status = 'active' LIMIT 1`
    );
    cachedAdminContact = (rows[0]?.values[0]?.[0] as string) || "管理员";
    adminContactFetchedAt = Date.now();
  } catch {
    cachedAdminContact = "管理员";
    adminContactFetchedAt = Date.now();
  }
  return cachedAdminContact;
}

/** 异步发送预警到 web 端（fire-and-forget，不阻塞主请求） */
async function fireQuotaAlerts(alerts: PendingAlert[]): Promise<void> {
  const webUrl = process.env.WEB_URL || "http://localhost:3000";
  const internalKey = process.env.INTERNAL_API_KEY;

  if (!internalKey) {
    console.warn("[QuotaAlert] INTERNAL_API_KEY not set, skipping alert dispatch");
    return;
  }

  try {
    const res = await fetch(`${webUrl}/api/internal/quota-alert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalKey}`,
      },
      body: JSON.stringify({ alerts }),
    });

    if (res.ok) {
      const result = await res.json() as { sent: number; skipped: number };
      console.log(`[QuotaAlert] Dispatched: sent=${result.sent}, skipped=${result.skipped}`);
    } else {
      const text = await res.text();
      console.error(`[QuotaAlert] Failed (${res.status}): ${text}`);
    }
  } catch (err) {
    console.error("[QuotaAlert] Network error:", err);
  }
}

/**
 * 限额检查中间件
 * 检查顺序：个人 → 部门 → 公司
 * DB-04: 使用 60s TTL 缓存 quota_rules 和用量查询结果
 */
export const quotaMiddleware = createMiddleware(async (c, next) => {
  const userId = c.get("userId");
  const { sqlite } = await getDb();
  const dbRaw = sqlite as unknown as SqliteExec;
  const ms = monthStart();

  // 从缓存获取规则和用户信息
  const cache = await getQuotaCache();
  const userInfo = cache.userMap.get(userId);
  if (!userInfo) {
    return c.json({ error: { message: "User not found", type: "auth_error" } }, 401);
  }

  const rules = cache.rules;

  // 辅助函数：查询本月已用费用（带缓存）
  const getUsed = (query: string, params: unknown[], cacheKey: string): number => {
    const cached = getCachedUsage(cacheKey);
    if (cached !== null) return cached;

    const r = dbRaw.exec(query, params);
    const value = Number(r[0]?.values[0]?.[0] ?? 0);
    setCachedUsage(cacheKey, value);
    return value;
  };

  // ===== 阈值定义 =====
  const ALERT_THRESHOLDS = {
    personal: 0.8,
    department: 0.8,
    company: 0.9,
  };

  // ===== 预先用量的变量（阈值检查复用） =====
  let used_personal = 0;
  let used_dept = 0;
  let used_company = 0;

  // ===== quota_info 公共字段 =====
  const period = currentPeriod();
  const adminContact = await getAdminContact();

  // 检查个人限额
  const personalRule = rules.find((r) => r.scope === "personal" && r.targetId === userId);
  if (personalRule) {
    used_personal = getUsed(
      `SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE user_id = ? AND created_at >= ?`,
      [userId, ms],
      `personal:${userId}:${ms}`
    );
    if (used_personal >= personalRule.monthlyLimit) {
      return c.json({
        error: {
          message: `您的本月额度已用完（${used_personal.toFixed(2)}/${personalRule.monthlyLimit.toFixed(2)}元），请联系管理员申请提额`,
          type: "quota_exceeded",
          quota_info: { used: used_personal, limit: personalRule.monthlyLimit, scope: "personal", period, adminContact },
        },
      }, 429);
    }
  }

  // 检查部门限额
  let deptRule: typeof personalRule = undefined;
  if (userInfo.departmentId) {
    deptRule = rules.find((r) => r.scope === "department" && r.targetId === userInfo.departmentId);
    if (deptRule) {
      used_dept = getUsed(
        `SELECT COALESCE(SUM(ul.cost), 0) FROM usage_logs ul
         JOIN users u ON ul.user_id = u.id
         WHERE u.department_id = ? AND ul.created_at >= ?`,
        [userInfo.departmentId, ms],
        `dept:${userInfo.departmentId}:${ms}`
      );
      if (used_dept >= deptRule.monthlyLimit) {
        return c.json({
          error: {
            message: `您所在部门本月预算已用完（${used_dept.toFixed(2)}/${deptRule.monthlyLimit.toFixed(2)}元）`,
            type: "quota_exceeded",
            quota_info: { used: used_dept, limit: deptRule.monthlyLimit, scope: "department", period, adminContact },
          },
        }, 429);
      }
    }
  }

  // 检查公司限额
  const companyRule = rules.find((r) => r.scope === "company");
  if (companyRule) {
    used_company = getUsed(
      `SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE created_at >= ?`,
      [ms],
      `company:${ms}`
    );
    if (used_company >= companyRule.monthlyLimit) {
      return c.json({
        error: {
          message: `公司本月AI预算已用完（${used_company.toFixed(2)}/${companyRule.monthlyLimit.toFixed(2)}元）`,
          type: "quota_exceeded",
          quota_info: { used: used_company, limit: companyRule.monthlyLimit, scope: "company", period, adminContact },
        },
      }, 429);
    }
  }

  await next();

  // ---- 阈值预警检查（非阻塞，fire-and-forget）----
  const pendingAlerts: PendingAlert[] = [];

  if (personalRule) {
    const ratio = used_personal / personalRule.monthlyLimit;
    if (ratio >= 1) {
      pendingAlerts.push({
        type: "personal_100",
        targetId: userId,
        userId,
        used: used_personal,
        limit: personalRule.monthlyLimit,
        percent: Math.round(ratio * 100),
      });
    } else if (ratio >= ALERT_THRESHOLDS.personal) {
      pendingAlerts.push({
        type: "personal_80",
        targetId: userId,
        userId,
        used: used_personal,
        limit: personalRule.monthlyLimit,
        percent: Math.round(ratio * 100),
      });
    }
  }

  if (deptRule && userInfo.departmentId) {
    const ratio = used_dept / deptRule.monthlyLimit;
    if (ratio >= ALERT_THRESHOLDS.department) {
      pendingAlerts.push({
        type: "dept_80",
        targetId: userInfo.departmentId,
        userId,
        used: used_dept,
        limit: deptRule.monthlyLimit,
        percent: Math.round(ratio * 100),
      });
    }
  }

  if (companyRule) {
    const ratio = used_company / companyRule.monthlyLimit;
    if (ratio >= ALERT_THRESHOLDS.company) {
      pendingAlerts.push({
        type: "company_90",
        targetId: "company",
        userId,
        used: used_company,
        limit: companyRule.monthlyLimit,
        percent: Math.round(ratio * 100),
      });
    }
  }

  if (pendingAlerts.length > 0) {
    fireQuotaAlerts(pendingAlerts).catch(() => {});
  }
});
