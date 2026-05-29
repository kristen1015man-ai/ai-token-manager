import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { usageLogs, users } from "../../../../../../shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db } = await getDb();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 今日汇总
  const todayResult = await db
    .select({
      tokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)`,
      cost: sql<number>`COALESCE(SUM(${usageLogs.cost}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.userId, session.userId),
        gte(usageLogs.createdAt, todayStart)
      )
    );

  // 本月汇总
  const monthResult = await db
    .select({
      tokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)`,
      cost: sql<number>`COALESCE(SUM(${usageLogs.cost}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.userId, session.userId),
        gte(usageLogs.createdAt, monthStart)
      )
    );

  // 获取用户限额
  const userInfo = await db
    .select({ monthlyQuota: users.monthlyQuota })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const monthlyQuota = userInfo[0]?.monthlyQuota ?? 200;
  const monthCost = monthResult[0]?.cost ?? 0;

  return NextResponse.json({
    todayTokens: todayResult[0]?.tokens ?? 0,
    todayCost: Number(todayResult[0]?.cost ?? 0),
    todayCount: todayResult[0]?.count ?? 0,
    monthTokens: monthResult[0]?.tokens ?? 0,
    monthCost: Number(monthCost),
    monthCount: monthResult[0]?.count ?? 0,
    monthlyQuota,
    quotaUsed: Number(monthCost),
    quotaRemaining: Math.max(0, monthlyQuota - Number(monthCost)),
  });
}
