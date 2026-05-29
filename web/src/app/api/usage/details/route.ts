import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { usageLogs } from "../../../../../../shared/schema";
import { eq, desc, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const page = parseInt(request.nextUrl.searchParams.get("page") || "1");
  const size = parseInt(request.nextUrl.searchParams.get("size") || "20");
  const offset = (page - 1) * size;

  const { db } = await getDb();

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(usageLogs)
      .where(eq(usageLogs.userId, session.userId))
      .orderBy(desc(usageLogs.createdAt))
      .limit(size)
      .offset(offset),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(usageLogs)
      .where(eq(usageLogs.userId, session.userId)),
  ]);

  const total = countResult[0]?.total ?? 0;

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      model: item.model,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      totalTokens: item.totalTokens,
      cost: Number(item.cost),
      createdAt: item.createdAt,
    })),
    pagination: {
      page,
      size,
      total,
      totalPages: Math.ceil(total / size),
    },
  });
}
