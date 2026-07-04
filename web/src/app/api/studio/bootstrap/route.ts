import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../lib/admin-check";
import { getDb, getRawExec } from "../../../../lib/db";
import { listUserApiKeys } from "../../../../lib/user-api-keys";
import { getBeijingMonthStartUnix, getTimeRange } from "../../../../lib/time-range";
import { ensureStudioTables } from "../../../../lib/studio-db";
import { getStudioModels, groupStudioModels } from "../../../../lib/studio-models";

export const dynamic = "force-dynamic";

function publicBaseUrl(request: NextRequest): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const protocol = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

function numberAt(row: unknown[][] | undefined, index: number, fallback = 0): number {
  const value = Number(row?.[0]?.[index] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function quotaStatus(percent: number): "normal" | "warning" | "critical" | "exceeded" {
  if (percent >= 100) return "exceeded";
  if (percent >= 90) return "critical";
  if (percent >= 80) return "warning";
  return "normal";
}

export async function GET(request: NextRequest) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const today = getTimeRange("day");
  const todayRows = raw.exec(
    `SELECT COALESCE(SUM(total_tokens), 0), COALESCE(SUM(cost), 0), COUNT(*)
     FROM usage_logs
     WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
    [session.userId, today.start, today.end]
  )[0]?.values;

  const monthStart = getBeijingMonthStartUnix();
  const monthRows = raw.exec(
    `SELECT COALESCE(SUM(total_tokens), 0), COALESCE(SUM(cost), 0), COUNT(*)
     FROM usage_logs
     WHERE user_id = ? AND created_at >= ?`,
    [session.userId, monthStart]
  )[0]?.values;

  const userRows = raw.exec(
    `SELECT id, name, email, avatar, role, COALESCE(monthly_quota, 0)
     FROM users
     WHERE id = ?`,
    [session.userId]
  )[0]?.values;
  const userRow = userRows?.[0];
  if (!userRow) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const monthlyQuota = Number(userRow[5] ?? 0);
  const monthCost = numberAt(monthRows, 1);
  const quotaPercent = monthlyQuota > 0 ? (monthCost / monthlyQuota) * 100 : 0;
  const models = getStudioModels(raw);
  const keys = listUserApiKeys(raw, session.userId);

  const recentSessions = raw.exec(
    `SELECT id, title, default_model, mode, updated_at
     FROM studio_sessions
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT 12`,
    [session.userId]
  )[0]?.values ?? [];

  const devices = raw.exec(
    `SELECT id, device_name, platform, agent_version, status, paired_at, last_seen_at
     FROM studio_agent_devices
     WHERE user_id = ?
     ORDER BY COALESCE(last_seen_at, paired_at) DESC
     LIMIT 8`,
    [session.userId]
  )[0]?.values ?? [];

  const base = publicBaseUrl(request);

  return NextResponse.json({
    user: {
      id: String(userRow[0]),
      name: String(userRow[1] ?? ""),
      email: userRow[2] ? String(userRow[2]) : null,
      avatar: userRow[3] ? String(userRow[3]) : null,
      role: String(userRow[4] ?? "member"),
    },
    quota: {
      todayCalls: numberAt(todayRows, 2),
      todayTokens: numberAt(todayRows, 0),
      todayCost: numberAt(todayRows, 1),
      monthCalls: numberAt(monthRows, 2),
      monthTokens: numberAt(monthRows, 0),
      monthCost,
      monthlyQuota,
      remaining: Math.max(0, monthlyQuota - monthCost),
      percent: quotaPercent,
      status: quotaStatus(quotaPercent),
    },
    gateway: {
      anthropicBaseUrl: `${base}/anthropic`,
      openAIBaseUrl: `${base}/v1`,
      modelDiscovery: true,
      env: {
        ANTHROPIC_BASE_URL: `${base}/anthropic`,
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
      },
    },
    apiKeys: keys.map((key) => ({
      id: key.id,
      name: key.name,
      maskedKey: key.maskedKey,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
    })),
    models,
    modelGroups: groupStudioModels(models),
    sessions: recentSessions.map((row) => ({
      id: String(row[0]),
      title: String(row[1] ?? "New Studio Session"),
      defaultModel: row[2] ? String(row[2]) : null,
      mode: String(row[3] ?? "default"),
      updatedAt: Number(row[4] ?? 0),
    })),
    devices: devices.map((row) => ({
      id: String(row[0]),
      name: String(row[1] ?? "Sparkloom Agent"),
      platform: row[2] ? String(row[2]) : null,
      version: row[3] ? String(row[3]) : null,
      status: String(row[4] ?? "active"),
      pairedAt: Number(row[5] ?? 0),
      lastSeenAt: row[6] ? Number(row[6]) : null,
    })),
    agent: {
      expectedProtocolVersion: 1,
      healthUrl: "http://127.0.0.1:39271/health",
      pairProtocol: "sparkloom://pair",
      reviewModeOnly: false,
    },
  });
}
