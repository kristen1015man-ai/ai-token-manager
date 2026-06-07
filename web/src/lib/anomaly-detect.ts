/**
 * 异常使用检测模块
 *
 * 检测逻辑（DEV-PLAN Phase 5）：
 * 1. 查询每个用户过去 7 天的用量 → 计算小时均值
 * 2. 查询每个用户过去 1 小时的用量
 * 3. 触发条件：1 小时用量 >= max(绝对阈值, 7 天小时均值 × 5 倍)
 * 4. 写入 alert_logs（type=anomaly）→ 飞书 Webhook 告警
 *
 * 绝对阈值从 alert_settings.anomaly_threshold 读取（默认 10 元），
 * 用于防止低用量用户的倍率波动触发误报。
 */

import { randomBytes } from "crypto";
import { getDb, saveDb } from "./db";
import { usageLogs, users, alertLogs, alertSettings } from "../../../shared/schema";
import { eq, gte, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { sendCardMessage } from "./feishu-bot";

// ===== 常量 =====
const ANOMALY_MULTIPLIER = 5; // DEV-PLAN: 7 天小时均值的 5 倍
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

// ===== 类型 =====
export interface AnomalyResult {
  userId: string;
  userName: string;
  department: string;
  hourlyCost: number;
  sevenDayAvgHourly: number;
  effectiveThreshold: number;
  multiplier: number;
}

export interface AnomalyCheckResult {
  checked: number;
  anomalies: AnomalyResult[];
  skipped: number; // 已在近 1 小时内告警过，跳过
}

// ===== 内部函数 =====

/** 读取异常检测相关设置 */
async function getSettings(): Promise<{
  threshold: number;
  notifyEnabled: boolean;
  notifyTypes: string[];
  webhookUrl: string;
}> {
  const { db } = await getDb();
  const rows = await db.select().from(alertSettings);

  const map: Record<string, string> = {
    anomaly_threshold: "10",
    feishu_notify_enabled: "false",
    feishu_notify_types: "personal_80,personal_100,dept_80,company_90,anomaly",
    feishu_webhook_url: "",
  };
  for (const r of rows) map[r.key] = r.value;

  return {
    threshold: parseFloat(map.anomaly_threshold) || 10,
    notifyEnabled: map.feishu_notify_enabled === "true",
    notifyTypes: map.feishu_notify_types.split(","),
    webhookUrl: map.feishu_webhook_url,
  };
}

/** 按用户汇总指定时间段内的用量 */
async function getUsageByUser(since: Date): Promise<Map<string, number>> {
  const { db } = await getDb();
  const rows = await db
    .select({
      userId: usageLogs.userId,
      totalCost: sql<number>`COALESCE(SUM(${usageLogs.cost}), 0)`,
    })
    .from(usageLogs)
    .where(gte(usageLogs.createdAt, since))
    .groupBy(usageLogs.userId);

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.userId, r.totalCost);
  return map;
}

/** 检查某用户近 1 小时内是否已有 anomaly 告警 */
async function hasRecentAlert(userId: string, since: Date): Promise<boolean> {
  const { db } = await getDb();
  const rows = await db
    .select({ id: alertLogs.id })
    .from(alertLogs)
    .where(
      and(
        eq(alertLogs.type, "anomaly"),
        eq(alertLogs.targetId, userId),
        gte(alertLogs.sentAt, since)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** 格式化单条异常消息 */
function formatAnomalyMessage(a: AnomalyResult): string {
  const multiplierStr =
    a.sevenDayAvgHourly > 0 ? `${a.multiplier.toFixed(1)} 倍` : "无历史用量";
  return `🚨 ${a.userName}（${a.department}）近 1 小时花费 ¥${a.hourlyCost.toFixed(2)}，7 天均值 ¥${a.sevenDayAvgHourly.toFixed(2)}/h（${multiplierStr}）`;
}

/** 发送飞书 Webhook 告警 */
async function sendAnomalyNotification(
  anomalies: AnomalyResult[],
  webhookUrl: string
): Promise<boolean> {
  if (!webhookUrl) {
    console.log("[AnomalyDetect] 未配置飞书 Webhook，跳过告警");
    return false;
  }

  const dangerLines = anomalies.map(
    (a) =>
      `🚨 **${a.userName}**（${a.department}）\n   近 1 小时：¥${a.hourlyCost.toFixed(2)}\n   7 天均值：¥${a.sevenDayAvgHourly.toFixed(2)}/h（${
        a.sevenDayAvgHourly > 0 ? `${a.multiplier.toFixed(1)} 倍` : "无历史"
      }）`
  );

  const payload = {
    msg_type: "interactive",
    card: {
      header: {
        title: {
          tag: "plain_text",
          content: `🚨 异常用量预警（${anomalies.length} 人）`,
        },
        template: "red",
      },
      elements: [
        {
          tag: "div",
          text: { tag: "lark_md", content: dangerLines.join("\n\n") },
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `⏰ 检测时间：${new Date().toLocaleString("zh-CN")}`,
          },
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: "💡 请确认是否存在异常调用，必要时联系相关人员",
          },
        },
      ],
    },
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await resp.json()) as { code?: number; msg?: string };
    if (result.code !== 0) {
      console.error(`[AnomalyDetect] 飞书告警失败: ${result.msg}`);
      return false;
    }
    console.log(
      `[AnomalyDetect] 飞书异常告警已发送: ${anomalies.length} 人`
    );
    return true;
  } catch (err) {
    console.error("[AnomalyDetect] 飞书告警异常:", err);
    return false;
  }
}

// ===== 对外接口 =====

/**
 * 执行一次异常检测
 *
 * 返回检测结果（已去重，同一用户 1 小时内只告警一次）
 */
export async function detectAnomalies(): Promise<AnomalyCheckResult> {
  const { db } = await getDb();
  const settings = await getSettings();

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - ONE_HOUR_MS);
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

  // 1. 批量查询用量（2 条 SQL，不逐用户查询）
  const [sevenDayMap, hourlyMap] = await Promise.all([
    getUsageByUser(sevenDaysAgo),
    getUsageByUser(oneHourAgo),
  ]);

  // 2. 获取活跃用户
  const activeUsers = await db
    .select({
      id: users.id,
      name: users.name,
      department: users.department,
    })
    .from(users)
    .where(eq(users.status, "active"));

  // 3. 筛选异常用户
  const candidates: AnomalyResult[] = [];
  for (const user of activeUsers) {
    const hourlyCost = hourlyMap.get(user.id) ?? 0;
    if (hourlyCost <= 0) continue;

    const sevenDayTotal = sevenDayMap.get(user.id) ?? 0;
    const sevenDayAvgHourly = sevenDayTotal / (7 * 24); // 168 小时
    const relativeThreshold = sevenDayAvgHourly * ANOMALY_MULTIPLIER;
    const effectiveThreshold = Math.max(settings.threshold, relativeThreshold);

    if (hourlyCost >= effectiveThreshold) {
      candidates.push({
        userId: user.id,
        userName: user.name,
        department: user.department || "未知部门",
        hourlyCost,
        sevenDayAvgHourly,
        effectiveThreshold,
        multiplier:
          sevenDayAvgHourly > 0 ? hourlyCost / sevenDayAvgHourly : Infinity,
      });
    }
  }

  if (candidates.length === 0) {
    return { checked: activeUsers.length, anomalies: [], skipped: 0 };
  }

  // 4. 去重：已告警过的用户跳过
  const newAnomalies: AnomalyResult[] = [];
  let skipped = 0;
  for (const c of candidates) {
    const already = await hasRecentAlert(c.userId, oneHourAgo);
    if (already) {
      skipped++;
    } else {
      newAnomalies.push(c);
    }
  }

  // 5. 写入 alert_logs
  for (const a of newAnomalies) {
    const alertId = `anomaly_${randomBytes(8).toString("hex")}`;
    await db.insert(alertLogs).values({
      id: alertId,
      type: "anomaly",
      targetId: a.userId,
      message: formatAnomalyMessage(a),
      sentAt: now,
    });
  }

  if (newAnomalies.length > 0) {
    await saveDb();
  }

  // 6. 飞书通知
  if (
    newAnomalies.length > 0 &&
    settings.notifyEnabled &&
    settings.notifyTypes.includes("anomaly")
  ) {
    await sendAnomalyNotification(newAnomalies, settings.webhookUrl);
  }

  console.log(
    `[AnomalyDetect] 检测完成: ${activeUsers.length} 人, ${candidates.length} 异常, ${newAnomalies.length} 新告警, ${skipped} 跳过`
  );

  return {
    checked: activeUsers.length,
    anomalies: newAnomalies,
    skipped,
  };
}
