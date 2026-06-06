import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../../lib/db";
import { alertSettings } from "../../../../../../../shared/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { apiHandler, apiHandlerNoBody } from "../../../../../lib/api-handler";

// ===== 默认值 =====
export const DEFAULT_ALERT_SETTINGS: Record<string, string> = {
  personal_threshold: "80",      // 个人用量达到限额的 80% 时预警
  dept_threshold: "80",          // 部门用量达到限额的 80% 时预警
  company_threshold: "90",       // 公司用量达到限额的 90% 时预警
  anomaly_threshold: "10",       // 单人1小时内用量超过 N 元时异常预警
  feishu_webhook_url: "",        // 飞书机器人 Webhook 地址
  feishu_notify_enabled: "false", // 是否启用飞书通知
  feishu_notify_types: "personal_80,personal_100,dept_80,company_90,anomaly", // 通知哪些类型
};

/** GET /api/admin/alerts/settings */
export const GET = apiHandlerNoBody(async () => {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const rows = await db.select().from(alertSettings);

  // 合并默认值
  const settings: Record<string, string> = { ...DEFAULT_ALERT_SETTINGS };
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  return NextResponse.json({ settings });
});

/** PUT /api/admin/alerts/settings — 批量更新 */
export const PUT = apiHandler(async (request: NextRequest) => {
  const { error, session } = await requireAdmin();
  if (error) return error;

  const body = await request.json() as Record<string, string>;
  const { db } = await getDb();

  const allowedKeys = new Set(Object.keys(DEFAULT_ALERT_SETTINGS));

  for (const [key, value] of Object.entries(body)) {
    if (!allowedKeys.has(key)) continue;

    // upsert：先检查是否存在
    const existing = await db.select().from(alertSettings).where(eq(alertSettings.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(alertSettings).set({
        value,
        updatedAt: new Date(),
      }).where(eq(alertSettings.key, key));
    } else {
      await db.insert(alertSettings).values({
        key,
        value,
        updatedAt: new Date(),
      });
    }
  }

  await saveDb();
  return NextResponse.json({ success: true });
});
