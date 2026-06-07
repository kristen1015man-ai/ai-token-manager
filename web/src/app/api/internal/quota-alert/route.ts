import { NextRequest, NextResponse } from "next/server";
import { getDb, scheduleSave } from "../../../../lib/db";
import { SqliteExec } from "../../../../lib/db";
import { alertLogs, alertSettings, users } from "../../../../../../shared/schema";
import { eq, and, gte } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendPrivateMessage, sendGroupMessage, formatQuotaAlert } from "../../../../lib/feishu-bot";
import { DEFAULT_ALERT_SETTINGS } from "../../admin/alerts/settings/route";

// ===== 类型定义 =====
interface QuotaAlert {
  type: "personal_80" | "personal_100" | "dept_80" | "company_90";
  targetId: string;
  userId: string;
  used: number;
  limit: number;
  percent: number;
}

/**
 * POST /api/internal/quota-alert
 * 内部端点：供 proxy 调用，发送限额预警通知
 *
 * 认证：通过 INTERNAL_API_KEY 环境变量进行简单 token 校验
 * Body: { alerts: QuotaAlert[] }
 */
export async function POST(request: NextRequest) {
  // 内部 API Key 校验
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) {
    console.error("[InternalAPI/quota-alert] INTERNAL_API_KEY not configured");
    return NextResponse.json({ error: "Internal API not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${internalKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { alerts?: unknown[] };
  try {
    body = await request.json();
  } catch {
    console.warn("[InternalAPI/quota-alert] Invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const alerts = body.alerts;
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return NextResponse.json({ error: "alerts must be a non-empty array" }, { status: 400 });
  }

  try {
    const { db, sqlite } = await getDb();
    const dbRaw = sqlite as unknown as SqliteExec;

    // 加载预警设置（合并默认值）
    const settingsRows = await db.select().from(alertSettings);
    const settings: Record<string, string> = { ...DEFAULT_ALERT_SETTINGS };
    for (const row of settingsRows) {
      settings[row.key] = row.value;
    }

    const feishuEnabled = settings.feishu_notify_enabled === "true";
    const feishuNotifyTypes = new Set(settings.feishu_notify_types.split(","));
    const feishuWebhookUrl = settings.feishu_webhook_url;

    // 今天零点的时间戳（秒）
    const todayStart = Math.floor(new Date(new Date().toISOString().slice(0, 10)).getTime() / 1000);

    let sent = 0;
    let skipped = 0;

    for (const rawAlert of alerts) {
      const alert = rawAlert as QuotaAlert;

      // 去重检查：今天是否已发送过同类型同 targetId 的预警
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

      // 写入 alert_logs
      await db.insert(alertLogs).values({
        id: randomBytes(8).toString("hex"),
        type: alert.type,
        targetId: alert.targetId,
        message: `${alert.type}: ${alert.used.toFixed(2)}/${alert.limit.toFixed(2)} (${alert.percent}%)`,
        sentAt: new Date(),
      });

      // 检查是否需要发送飞书通知
      if (!feishuEnabled || !feishuNotifyTypes.has(alert.type)) {
        skipped++;
        continue;
      }

      try {
        if (alert.type === "personal_80" || alert.type === "personal_100") {
          // 个人预警：查用户 feishu_id，发私聊
          const userRows = dbRaw.exec(
            `SELECT feishu_id, name, department FROM users WHERE id = ?`,
            [alert.userId]
          );
          if (userRows[0] && userRows[0].values.length > 0) {
            const [feishuId, name, department] = userRows[0].values[0];

            // 计算剩余天数（当月最后一天 - 今天）
            const now = new Date();
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const remainingDays = lastDay - now.getDate();

            const message = formatQuotaAlert({
              userName: String(name),
              department: String(department || "未知部门"),
              used: alert.used,
              limit: alert.limit,
              percent: alert.percent,
              remainingDays,
            });

            await sendPrivateMessage(String(feishuId), message);
            sent++;
          } else {
            console.warn(`[quota-alert] User ${alert.userId} not found for alert`);
            skipped++;
          }
        } else if (alert.type === "dept_80" || alert.type === "company_90") {
          // 部门/公司预警：通过 webhook 群消息
          if (feishuWebhookUrl) {
            const now = new Date();
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const remainingDays = lastDay - now.getDate();

            const scopeLabel = alert.type === "dept_80" ? "部门" : "公司";
            const message = formatQuotaAlert({
              userName: scopeLabel,
              department: alert.targetId,
              used: alert.used,
              limit: alert.limit,
              percent: alert.percent,
              remainingDays,
            });

            await sendGroupMessage(feishuWebhookUrl, message);
            sent++;
          } else {
            console.warn(`[quota-alert] No feishu_webhook_url configured for ${alert.type}`);
            skipped++;
          }
        }
      } catch (notifyErr) {
        console.error(`[quota-alert] Failed to send notification for ${alert.type}:`, notifyErr);
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
