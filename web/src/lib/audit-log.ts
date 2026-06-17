import { randomBytes } from "crypto";
import { desc, eq, and, sql } from "drizzle-orm";
import { adminLogs } from "../../../shared/schema";
import { getDb, saveDb } from "./db";

/**
 * 管理员操作审计日志
 *
 * 使用方式：
 *   import { auditLog } from "@/lib/audit-log";
 *   await auditLog(adminId, "create", "channel", channelId, { name, provider });
 */

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "toggle"
  | "sync"
  | "export"
  | "migrate"
  | "reset_key"
  | "batch_update";

export type AuditTarget =
  | "channel"
  | "user"
  | "model"
  | "price"
  | "quota"
  | "permission"
  | "department"
  | "employee"
  | "org_structure"
  | "alert_setting"
  | "exchange_rate"
  | "billing"
  | "system";

/**
 * 写入一条审计日志
 *
 * @param adminId   管理员用户 ID
 * @param action    操作类型
 * @param targetType 目标实体类型
 * @param targetId  目标实体 ID（批量操作可用 "batch"）
 * @param detail    操作详情（变更前后快照等）
 */
export async function auditLog(
  adminId: string,
  action: AuditAction,
  targetType: AuditTarget,
  targetId: string,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    const { db } = await getDb();
    const id = randomBytes(8).toString("hex");

    await db.insert(adminLogs).values({
      id,
      adminId,
      action,
      targetType,
      targetId,
      detail: detail || null,
      createdAt: new Date(),
    });

    await saveDb();
  } catch (err) {
    // 审计日志写入失败不应阻断业务流程，只打印错误
    console.error("[audit-log] 写入失败:", err);
  }
}

/**
 * 查询审计日志
 *
 * @param options 筛选条件
 * @returns 日志列表 + 总数
 */
export async function queryAuditLogs(options: {
  targetType?: string;
  action?: string;
  adminId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: unknown[]; total: number }> {
  const { db } = await getDb();
  const limit = Math.min(options.limit || 50, 200);
  const offset = options.offset || 0;

  // 构建 WHERE 条件（数据库级别过滤，避免全量加载）
  const conditions = [];
  if (options.targetType) conditions.push(eq(adminLogs.targetType, options.targetType));
  if (options.action) conditions.push(eq(adminLogs.action, options.action));
  if (options.adminId) conditions.push(eq(adminLogs.adminId, options.adminId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // 总数查询
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(adminLogs)
    .where(where);
  const total = Number(countResult[0]?.count ?? 0);

  // 分页查询
  const logs = await db
    .select()
    .from(adminLogs)
    .where(where)
    .orderBy(desc(adminLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return { logs, total };
}
