import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { quotaRules, users } from "../../../../../../../../shared/schema";
import { getDb, getRawExec, scheduleSave, type SqliteExec } from "../../../../../../lib/db";
import { requireInternalRequest } from "../../../../../../lib/internal-auth";
import { calculateCost } from "../../../../../../lib/proxy/cache";

function monthStart(): number {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
}

function ruleTimestamp(rule: { updatedAt: Date | number | null }): number {
  if (rule.updatedAt instanceof Date) return rule.updatedAt.getTime();
  return Number(rule.updatedAt ?? 0);
}

function reservationTtlSeconds(): number {
  const parsed = Number(process.env.QUOTA_RESERVATION_TTL_SECONDS ?? 1800);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1800;
}

function finiteNonNegative(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function ensureReservationTable(db: SqliteExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quota_reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      department_id TEXT,
      channel_id TEXT,
      model TEXT,
      estimated_cost REAL NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_qr_user_expires ON quota_reservations(user_id, expires_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_qr_dept_expires ON quota_reservations(department_id, expires_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_qr_expires ON quota_reservations(expires_at)");
}

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  let body: {
    userId?: unknown;
    channelId?: unknown;
    model?: unknown;
    estimatedInputTokens?: unknown;
    estimatedOutputTokens?: unknown;
    cachedTokens?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const { db, sqlite } = await getDb();
  const rawDb = getRawExec(sqlite);
  ensureReservationTable(rawDb);
  const nowSec = Math.floor(Date.now() / 1000);
  rawDb.exec("DELETE FROM quota_reservations WHERE expires_at <= ?", [nowSec]);

  const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (userResult.length === 0 || userResult[0].status !== "active") {
    return NextResponse.json({
      ok: false,
      message: "User does not exist or is disabled",
      type: "auth_error",
    }, { status: 401 });
  }

  const user = userResult[0];
  const rules = await db.select().from(quotaRules);
  const ms = monthStart();
  const period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const model = typeof body.model === "string" ? body.model : "";
  const estimatedInputTokens = finiteNonNegative(body.estimatedInputTokens);
  const estimatedOutputTokens = finiteNonNegative(body.estimatedOutputTokens);
  const cachedTokens = finiteNonNegative(body.cachedTokens);

  let estimatedCost = 0;
  if (channelId && model && estimatedInputTokens + estimatedOutputTokens > 0) {
    try {
      estimatedCost = await calculateCost(channelId, model, estimatedInputTokens, estimatedOutputTokens, cachedTokens);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Missing or invalid model price";
      return NextResponse.json({ ok: false, message, type: "pricing_error" }, { status: 422 });
    }
  }

  const getAmount = (query: string, params: unknown[]) => {
    const result = rawDb.exec(query, params);
    return Number(result[0]?.values[0]?.[0] ?? 0);
  };

  const exceedsLimit = (used: number, reserved: number, limit: number) =>
    used >= limit || used + reserved + estimatedCost > limit;

  const personalRule = rules
    .filter((rule) => rule.scope === "personal" && rule.targetId === userId)
    .sort((a, b) => ruleTimestamp(b) - ruleTimestamp(a))[0];
  const personalLimit = personalRule?.monthlyLimit ?? user.monthlyQuota ?? null;
  if (personalLimit !== null) {
    const used = getAmount(
      "SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE user_id = ? AND created_at >= ?",
      [userId, ms]
    );
    const reserved = getAmount(
      "SELECT COALESCE(SUM(estimated_cost), 0) FROM quota_reservations WHERE user_id = ? AND expires_at > ?",
      [userId, nowSec]
    );
    if (exceedsLimit(used, reserved, personalLimit)) {
      return NextResponse.json({
        ok: false,
        message: "Monthly personal quota exceeded",
        type: "quota_exceeded",
        quotaInfo: { used, reserved, estimatedCost, limit: personalLimit, scope: "personal", period },
      }, { status: 429 });
    }
  }

  if (user.departmentId) {
    const deptRule = rules
      .filter((rule) => rule.scope === "department" && rule.targetId === user.departmentId)
      .sort((a, b) => ruleTimestamp(b) - ruleTimestamp(a))[0];
    if (deptRule) {
      const used = getAmount(
        "SELECT COALESCE(SUM(ul.cost), 0) FROM usage_logs ul JOIN users u ON ul.user_id = u.id WHERE u.department_id = ? AND ul.created_at >= ?",
        [user.departmentId, ms]
      );
      const reserved = getAmount(
        "SELECT COALESCE(SUM(estimated_cost), 0) FROM quota_reservations WHERE department_id = ? AND expires_at > ?",
        [user.departmentId, nowSec]
      );
      if (exceedsLimit(used, reserved, deptRule.monthlyLimit)) {
        return NextResponse.json({
          ok: false,
          message: "Monthly department quota exceeded",
          type: "quota_exceeded",
          quotaInfo: { used, reserved, estimatedCost, limit: deptRule.monthlyLimit, scope: "department", period },
        }, { status: 429 });
      }
    }
  }

  const companyRule = rules
    .filter((rule) => rule.scope === "company")
    .sort((a, b) => ruleTimestamp(b) - ruleTimestamp(a))[0];
  if (companyRule) {
    const used = getAmount("SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE created_at >= ?", [ms]);
    const reserved = getAmount(
      "SELECT COALESCE(SUM(estimated_cost), 0) FROM quota_reservations WHERE expires_at > ?",
      [nowSec]
    );
    if (exceedsLimit(used, reserved, companyRule.monthlyLimit)) {
      return NextResponse.json({
        ok: false,
        message: "Monthly company quota exceeded",
        type: "quota_exceeded",
        quotaInfo: { used, reserved, estimatedCost, limit: companyRule.monthlyLimit, scope: "company", period },
      }, { status: 429 });
    }
  }

  let reservationId: string | null = null;
  if (estimatedCost > 0) {
    reservationId = `qr_${randomBytes(8).toString("hex")}`;
    rawDb.exec(
      `INSERT INTO quota_reservations
        (id, user_id, department_id, channel_id, model, estimated_cost, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reservationId,
        userId,
        user.departmentId || null,
        channelId,
        model,
        estimatedCost,
        nowSec,
        nowSec + reservationTtlSeconds(),
      ]
    );
    scheduleSave();
  }

  return NextResponse.json({ ok: true, reservationId, estimatedCost });
}
