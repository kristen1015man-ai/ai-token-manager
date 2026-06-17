import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";
import { quotaRules, users } from "../../../../../../shared/schema";
import { and, eq } from "drizzle-orm";
import { auditLog } from "../../../../lib/audit-log";
import { apiHandler, apiHandlerNoBody } from "../../../../lib/api-handler";

export const GET = apiHandlerNoBody(async () => {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const rules = await db.select().from(quotaRules);

  // 获取所有用户（用于个人限额展示）
  const allUsers = await db.select({
    id: users.id,
    name: users.name,
    avatar: users.avatar,
    department: users.department,
    monthlyQuota: users.monthlyQuota,
  }).from(users).where(eq(users.status, "active"));
  const personalLimits = new Map<string, { limit: number; updatedAt: number }>();
  for (const rule of rules) {
    if (rule.scope !== "personal") continue;
    const updatedAt = rule.updatedAt instanceof Date ? rule.updatedAt.getTime() : Number(rule.updatedAt ?? 0);
    const current = personalLimits.get(rule.targetId);
    if (!current || updatedAt >= current.updatedAt) {
      personalLimits.set(rule.targetId, { limit: rule.monthlyLimit, updatedAt });
    }
  }
  const displayUsers = allUsers.map((user) => ({
    ...user,
    monthlyQuota: personalLimits.get(user.id)?.limit ?? user.monthlyQuota ?? 200,
  }));

  // 从规则中提取公司限额
  const companyRule = rules.find((r) => r.scope === "company");
  const companyLimit = companyRule?.monthlyLimit ?? null;

  // 提取部门列表
  const departments = [...new Set(displayUsers.map((u) => u.department).filter(Boolean))] as string[];

  return NextResponse.json({ rules, users: displayUsers, companyLimit, departments });
});

export const POST = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const body = await request.json();
  const { scope, targetId, monthlyLimit } = body;

  if (scope === "batch") {
    const rawTargets = Array.isArray(body.targets) ? body.targets : null;
    if (!rawTargets || rawTargets.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const targets = new Map<string, number>();
    for (let index = 0; index < rawTargets.length; index += 1) {
      const item = rawTargets[index];
      const batchTargetId = typeof item?.targetId === "string" ? item.targetId.trim() : "";
      const batchLimit = Number(item?.monthlyLimit);

      if (!batchTargetId || item?.monthlyLimit === undefined || item?.monthlyLimit === null) {
        return NextResponse.json({ error: `Missing required fields at targets[${index}]` }, { status: 400 });
      }
      if (!Number.isFinite(batchLimit) || batchLimit < 0) {
        return NextResponse.json({ error: `monthlyLimit at targets[${index}] must be a non-negative number` }, { status: 400 });
      }

      targets.set(batchTargetId, batchLimit);
    }

    const { db } = await getDb();
    const now = new Date();

    for (const [batchTargetId, batchLimit] of targets) {
      const existing = await db.select().from(quotaRules)
        .where(and(eq(quotaRules.scope, "personal"), eq(quotaRules.targetId, batchTargetId)))
        .limit(1);

      if (existing.length > 0) {
        await db.update(quotaRules)
          .set({ monthlyLimit: batchLimit, updatedBy: session.userId, updatedAt: now })
          .where(eq(quotaRules.id, existing[0].id));
      } else {
        await db.insert(quotaRules).values({
          id: randomBytes(8).toString("hex"),
          scope: "personal",
          targetId: batchTargetId,
          monthlyLimit: batchLimit,
          updatedBy: session.userId,
          updatedAt: now,
        });
      }

      await db.update(users)
        .set({ monthlyQuota: batchLimit, updatedAt: now })
        .where(eq(users.id, batchTargetId));
    }

    await saveDb();
    await auditLog(session.userId, "batch_update", "quota", "personal", {
      scope: "personal",
      count: targets.size,
    });
    return NextResponse.json({ success: true, updated: targets.size });
  }

  const parsedLimit = Number(monthlyLimit);

  if (!scope || !targetId || monthlyLimit === undefined || monthlyLimit === null) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!["company", "department", "personal"].includes(scope)) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }
  if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
    return NextResponse.json({ error: "monthlyLimit must be a non-negative number" }, { status: 400 });
  }

  const { db } = await getDb();

  // Upsert：如果已有规则则更新，否则创建
  const existing = await db.select().from(quotaRules)
    .where(and(eq(quotaRules.scope, scope), eq(quotaRules.targetId, targetId)))
    .limit(1);

  if (existing.length > 0) {
    await db.update(quotaRules)
      .set({ monthlyLimit: parsedLimit, scope, updatedBy: session.userId, updatedAt: new Date() })
      .where(eq(quotaRules.id, existing[0].id));
  } else {
    await db.insert(quotaRules).values({
      id: randomBytes(8).toString("hex"),
      scope,
      targetId,
      monthlyLimit: parsedLimit,
      updatedBy: session.userId,
      updatedAt: new Date(),
    });
  }

  // 如果是个人限额，也更新 users 表的 monthlyQuota
  if (scope === "personal") {
    await db.update(users)
      .set({ monthlyQuota: parsedLimit, updatedAt: new Date() })
      .where(eq(users.id, targetId));
  }

  await saveDb();
  await auditLog(session.userId, "update", "quota", targetId, { scope, monthlyLimit: parsedLimit });
  return NextResponse.json({ success: true });
});
