import { randomBytes } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { adminLogs } from "../../../shared/schema";
import { getDb, saveDb } from "./db";

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

export async function auditLog(
  adminId: string,
  action: AuditAction,
  targetType: AuditTarget,
  targetId: string,
  detail?: Record<string, unknown>
): Promise<void> {
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
}

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

  const conditions = [];
  if (options.targetType) conditions.push(eq(adminLogs.targetType, options.targetType));
  if (options.action) conditions.push(eq(adminLogs.action, options.action));
  if (options.adminId) conditions.push(eq(adminLogs.adminId, options.adminId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(adminLogs)
    .where(where);
  const total = Number(countResult[0]?.count ?? 0);

  const logs = await db
    .select()
    .from(adminLogs)
    .where(where)
    .orderBy(desc(adminLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return { logs, total };
}
