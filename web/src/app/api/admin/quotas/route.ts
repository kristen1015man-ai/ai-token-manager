import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";
import { quotaRules, users } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";
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
  }).from(users);

  // 从规则中提取公司限额
  const companyRule = rules.find((r) => r.scope === "company");
  const companyLimit = companyRule?.monthlyLimit ?? null;

  // 提取部门列表
  const departments = [...new Set(allUsers.map((u) => u.department).filter(Boolean))] as string[];

  return NextResponse.json({ rules, users: allUsers, companyLimit, departments });
});

export const POST = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const body = await request.json();
  const { scope, targetId, monthlyLimit } = body;

  if (!scope || !targetId || !monthlyLimit) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { db } = await getDb();

  // Upsert：如果已有规则则更新，否则创建
  const existing = await db.select().from(quotaRules)
    .where(eq(quotaRules.targetId, targetId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(quotaRules)
      .set({ monthlyLimit, scope, updatedAt: new Date() })
      .where(eq(quotaRules.id, existing[0].id));
  } else {
    await db.insert(quotaRules).values({
      id: randomBytes(8).toString("hex"),
      scope,
      targetId,
      monthlyLimit,
      updatedBy: null,
      updatedAt: new Date(),
    });
  }

  // 如果是个人限额，也更新 users 表的 monthlyQuota
  if (scope === "personal") {
    await db.update(users)
      .set({ monthlyQuota: monthlyLimit, updatedAt: new Date() })
      .where(eq(users.id, targetId));
  }

  await saveDb();
  await auditLog(session.userId, "update", "quota", targetId, { scope, monthlyLimit });
  return NextResponse.json({ success: true });
});
