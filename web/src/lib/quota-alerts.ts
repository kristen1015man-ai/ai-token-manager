import { and, eq, gte } from "drizzle-orm";
import { alertLogs, alertSettings } from "../../../shared/schema";
import { getDb, getRawExec } from "./db";
import { beijingRemainingDaysInMonth, beijingStartOfDayUnix } from "./beijing-time";
import { getBeijingMonthStartUnix } from "./time-range";
import { formatQuotaAlert } from "./feishu-bot";
import { notifyAlert, type AlertType } from "./notification-router";

const DEFAULT_THRESHOLDS = {
  personal: 80,
  department: 80,
  company: 90,
};

function parseThreshold(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
}

async function loadThresholds(): Promise<typeof DEFAULT_THRESHOLDS> {
  const { db } = await getDb();
  const rows = await db.select().from(alertSettings);
  const settings = new Map(rows.map((row) => [row.key, row.value]));

  return {
    personal: parseThreshold(settings.get("personal_threshold"), DEFAULT_THRESHOLDS.personal),
    department: parseThreshold(settings.get("dept_threshold"), DEFAULT_THRESHOLDS.department),
    company: parseThreshold(settings.get("company_threshold"), DEFAULT_THRESHOLDS.company),
  };
}

async function hasAlertToday(type: AlertType, targetId: string): Promise<boolean> {
  const { db } = await getDb();
  const rows = await db
    .select({ id: alertLogs.id })
    .from(alertLogs)
    .where(
      and(
        eq(alertLogs.type, type),
        eq(alertLogs.targetId, targetId),
        gte(alertLogs.sentAt, new Date(beijingStartOfDayUnix() * 1000))
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function notifyPersonalQuota(userId: string, threshold: number): Promise<void> {
  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  const monthStart = getBeijingMonthStartUnix();

  const userRows = db.exec(
    `SELECT id, feishu_id, name, department, COALESCE(monthly_quota, 0)
     FROM users
     WHERE id = ? AND status = 'active'
     LIMIT 1`,
    [userId]
  );
  const user = userRows[0]?.values[0];
  if (!user) return;

  const limit = Number(user[4] ?? 0);
  if (limit <= 0) return;

  const usedRows = db.exec(
    "SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE user_id = ? AND created_at >= ?",
    [userId, monthStart]
  );
  const used = Number(usedRows[0]?.values[0]?.[0] ?? 0);
  const percent = (used / limit) * 100;
  if (percent < threshold && percent < 100) return;

  const type: AlertType = percent >= 100 ? "personal_100" : "personal_80";
  if (await hasAlertToday(type, userId)) return;

  const feishuId = String(user[1] || "");
  if (!feishuId) return;

  const message = formatQuotaAlert({
    userName: String(user[2] || "员工"),
    department: String(user[3] || "未分配部门"),
    used,
    limit,
    percent: Number(percent.toFixed(1)),
    threshold,
    remainingDays: beijingRemainingDaysInMonth(),
  });

  await notifyAlert({
    type,
    targetId: userId,
    message,
    recipientFeishuId: feishuId,
  });
}

async function notifyAggregateQuota(params: {
  type: "dept_80" | "company_90";
  targetId: string;
  label: string;
  used: number;
  limit: number;
  threshold: number;
}): Promise<void> {
  const { type, targetId, label, used, limit, threshold } = params;
  if (limit <= 0) return;

  const percent = (used / limit) * 100;
  if (percent < threshold && percent < 100) return;
  if (await hasAlertToday(type, targetId)) return;

  const message = formatQuotaAlert({
    userName: type === "dept_80" ? "部门额度" : "公司额度",
    department: label,
    used,
    limit,
    percent: Number(percent.toFixed(1)),
    threshold,
    remainingDays: beijingRemainingDaysInMonth(),
  });

  await notifyAlert({
    type,
    targetId,
    message,
    card: {
      title: type === "dept_80" ? "部门额度预警" : "公司额度预警",
      template: percent >= 100 ? "red" : "orange",
      elements: [message],
    },
  });
}

async function notifyDepartmentQuotas(userIds: string[], threshold: number): Promise<void> {
  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  const monthStart = getBeijingMonthStartUnix();
  const placeholders = userIds.map(() => "?").join(",");
  const impacted = db.exec(
    `SELECT DISTINCT department_id, COALESCE(department, department_id, '未分配部门')
     FROM users
     WHERE id IN (${placeholders}) AND status = 'active' AND department_id IS NOT NULL AND department_id != ''`,
    userIds
  );

  for (const row of impacted[0]?.values ?? []) {
    const departmentId = String(row[0] || "");
    const departmentName = String(row[1] || departmentId);
    if (!departmentId) continue;

    const limitRows = db.exec(
      `SELECT monthly_limit
       FROM quota_rules
       WHERE scope = 'department' AND target_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [departmentId]
    );
    const limit = Number(limitRows[0]?.values?.[0]?.[0] ?? 0);
    if (limit <= 0) continue;

    const usedRows = db.exec(
      `SELECT COALESCE(SUM(ul.cost), 0)
       FROM usage_logs ul
       JOIN users u ON u.id = ul.user_id
       WHERE u.status = 'active' AND u.department_id = ? AND ul.created_at >= ?`,
      [departmentId, monthStart]
    );
    const used = Number(usedRows[0]?.values?.[0]?.[0] ?? 0);
    await notifyAggregateQuota({
      type: "dept_80",
      targetId: departmentId,
      label: departmentName,
      used,
      limit,
      threshold,
    });
  }
}

async function notifyCompanyQuota(threshold: number): Promise<void> {
  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  const monthStart = getBeijingMonthStartUnix();

  const limitRows = db.exec(
    `SELECT monthly_limit
     FROM quota_rules
     WHERE scope = 'company'
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  const limit = Number(limitRows[0]?.values?.[0]?.[0] ?? 0);
  if (limit <= 0) return;

  const usedRows = db.exec(
    `SELECT COALESCE(SUM(ul.cost), 0)
     FROM usage_logs ul
     JOIN users u ON u.id = ul.user_id
     WHERE u.status = 'active' AND ul.created_at >= ?`,
    [monthStart]
  );
  const used = Number(usedRows[0]?.values?.[0]?.[0] ?? 0);
  await notifyAggregateQuota({
    type: "company_90",
    targetId: "all",
    label: "全公司",
    used,
    limit,
    threshold,
  });
}

export async function checkQuotaAlertsForUsers(userIds: string[]): Promise<void> {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return;

  const thresholds = await loadThresholds();
  for (const userId of uniqueUserIds) {
    try {
      await notifyPersonalQuota(userId, thresholds.personal);
    } catch (err) {
      console.error(`[QuotaAlerts] Failed to process personal alert for ${userId}:`, err);
    }
  }
  try {
    await notifyDepartmentQuotas(uniqueUserIds, thresholds.department);
  } catch (err) {
    console.error("[QuotaAlerts] Failed to process department alerts:", err);
  }
  try {
    await notifyCompanyQuota(thresholds.company);
  } catch (err) {
    console.error("[QuotaAlerts] Failed to process company alert:", err);
  }
}
