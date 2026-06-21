import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { alertLogs, alertSettings, users } from "../../../../../../shared/schema";
import { getDb, scheduleSave, getRawExec } from "../../../../lib/db";
import { beijingRemainingDaysInMonth, beijingStartOfDayUnix } from "../../../../lib/beijing-time";
import { formatQuotaAlert } from "../../../../lib/feishu-bot";
import { requireInternalRequest } from "../../../../lib/internal-auth";
import { notifyAlert } from "../../../../lib/notification-router";
import { safeErrorSummary } from "../../../../lib/safe-error";
import { DEFAULT_ALERT_SETTINGS } from "../../admin/alerts/settings/route";

interface QuotaAlert {
  type: "personal_80" | "personal_100" | "dept_80" | "company_90";
  targetId: string;
  userId: string;
  used: number;
  limit: number;
  percent: number;
  threshold?: number;
}

function parseThreshold(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback;
}

function thresholdFor(type: QuotaAlert["type"], settings: Record<string, string>): number | undefined {
  if (type === "personal_80") return parseThreshold(settings.personal_threshold, 80);
  if (type === "dept_80") return parseThreshold(settings.dept_threshold, 80);
  if (type === "company_90") return parseThreshold(settings.company_threshold, 90);
  return undefined;
}

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  let body: { alerts?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const alerts = body.alerts;
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return NextResponse.json({ error: "alerts must be a non-empty array" }, { status: 400 });
  }

  try {
    const { db, sqlite } = await getDb();
    const rawDb = getRawExec(sqlite);

    const settingsRows = await db.select().from(alertSettings);
    const settings: Record<string, string> = { ...DEFAULT_ALERT_SETTINGS };
    for (const row of settingsRows) settings[row.key] = row.value;

    const feishuEnabled = settings.feishu_notify_enabled === "true";
    const feishuNotifyTypes = new Set(settings.feishu_notify_types.split(",").map((item) => item.trim()).filter(Boolean));
    const todayStart = beijingStartOfDayUnix();
    const remainingDays = beijingRemainingDaysInMonth();

    let sent = 0;
    let skipped = 0;

    for (const rawAlert of alerts) {
      const alert = rawAlert as QuotaAlert;
      const threshold = alert.threshold ?? thresholdFor(alert.type, settings);

      const existing = await db
        .select({ id: alertLogs.id })
        .from(alertLogs)
        .where(
          and(
            eq(alertLogs.type, alert.type),
            eq(alertLogs.targetId, alert.targetId),
            gte(alertLogs.sentAt, new Date(todayStart * 1000))
          )
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      if (!feishuEnabled || !feishuNotifyTypes.has(alert.type)) {
        skipped++;
        continue;
      }

      try {
        if (alert.type === "personal_80" || alert.type === "personal_100") {
          const userRows = rawDb.exec(
            "SELECT feishu_id, name, department FROM users WHERE id = ?",
            [alert.userId]
          );
          if (!userRows[0] || userRows[0].values.length === 0) {
            skipped++;
            continue;
          }

          const [feishuId, name, department] = userRows[0].values[0];
          const message = formatQuotaAlert({
            userName: String(name),
            department: String(department || "未知部门"),
            used: alert.used,
            limit: alert.limit,
            percent: alert.percent,
            threshold,
            remainingDays,
          });

          const result = await notifyAlert({
            type: alert.type,
            targetId: alert.targetId,
            message,
            recipientFeishuId: String(feishuId),
          });
          sent += result.sent;
          skipped += result.skipped;
        } else {
          const scopeLabel = alert.type === "dept_80" ? "部门" : "公司";
          const message = formatQuotaAlert({
            userName: scopeLabel,
            department: alert.targetId,
            used: alert.used,
            limit: alert.limit,
            percent: alert.percent,
            threshold,
            remainingDays,
          });

          const result = await notifyAlert({
            type: alert.type,
            targetId: alert.targetId,
            message,
            card: {
              title: alert.type === "dept_80" ? "部门额度预警" : "公司额度预警",
              template: "orange",
              elements: [message],
            },
          });
          sent += result.sent;
          skipped += result.skipped;
        }
      } catch (notifyErr) {
        console.error(`[quota-alert] Failed to send notification for ${alert.type}:`, safeErrorSummary(notifyErr));
        skipped++;
      }
    }

    scheduleSave();

    return NextResponse.json({ success: true, sent, skipped });
  } catch (err) {
    console.error("[InternalAPI/quota-alert] Error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
