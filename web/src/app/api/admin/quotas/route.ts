import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";
import { quotaRules, users } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const rules = await db.select().from(quotaRules);

  // 获取所有用户（用于个人限额展示）
  const allUsers = await db.select({
    id: users.id,
    name: users.name,
    department: users.department,
    monthlyQuota: users.monthlyQuota,
  }).from(users);

  return NextResponse.json({ rules, users: allUsers });
}

export async function POST(request: NextRequest) {
  const { error: authError } = await requireAdmin();
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
  return NextResponse.json({ success: true });
}
