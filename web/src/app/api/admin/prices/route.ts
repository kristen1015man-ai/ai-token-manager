import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb, type SqliteExec } from "../../../../lib/db";
import { modelPrices, channels, syncBlacklist } from "../../../../../../shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { apiHandler, apiHandlerNoBody } from "../../../../lib/api-handler";

/** 获取所有模型价格 */
export const GET = apiHandlerNoBody(async () => {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();

  const priceList = await db.select().from(modelPrices);

  // 获取渠道列表用于显示名称和币种/供应商标识
  const channelList = await db.select({
    id: channels.id,
    name: channels.name,
    currency: channels.currency,
    provider: channels.provider,
  }).from(channels);
  const channelMap = new Map(channelList.map((c) => [c.id, c]));

  // 获取当前汇率
  let exchangeRate: { rate: number; source: string } | null = null;
  try {
    const { getUsdCnyRate } = await import("../../../../lib/exchange-rate");
    exchangeRate = await getUsdCnyRate();
  } catch (err) {
    console.warn("[Prices] 获取汇率失败:", err);
    exchangeRate = null;
  }

  return NextResponse.json({
    prices: priceList.map((p) => {
      const ch = p.channelId ? channelMap.get(p.channelId) : null;
      return {
        ...p,
        channelName: ch?.name || (p.channelId ? "未知渠道" : "全局（默认）"),
        channelCurrency: ch?.currency || null,
        channelProvider: ch?.provider || null,
      };
    }),
    exchangeRate,
  });
});

/** 创建模型价格（支持渠道专属定价） */
export const POST = apiHandler(async (request: NextRequest) => {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const body = await request.json();
  const { model, channelId, inputPerMillion, outputPerMillion, cachePerMillion, displayName, currency } = body;

  if (!model) return NextResponse.json({ error: "缺少 model" }, { status: 400 });
  if (inputPerMillion === undefined || outputPerMillion === undefined) {
    return NextResponse.json({ error: "缺少 inputPerMillion 或 outputPerMillion" }, { status: 400 });
  }

  const { db } = await getDb();

  // 唯一性检查：(channelId, model) 组合不能重复
  const normalizedChannelId = channelId || null;
  const existing = normalizedChannelId
    ? await db.select({ id: modelPrices.id }).from(modelPrices)
        .where(and(eq(modelPrices.model, model), eq(modelPrices.channelId, normalizedChannelId)))
        .limit(1)
    : await db.select({ id: modelPrices.id }).from(modelPrices)
        .where(and(eq(modelPrices.model, model), isNull(modelPrices.channelId)))
        .limit(1);
  if (existing.length > 0) {
    const label = normalizedChannelId ? `渠道 ${normalizedChannelId}` : "全局";
    return NextResponse.json(
      { error: `${label} 已存在模型 ${model} 的价格` },
      { status: 409 }
    );
  }

  const id = `price_${randomBytes(8).toString("hex")}`;
  const now = new Date();

  await db.insert(modelPrices).values({
    id,
    model,
    channelId: normalizedChannelId,
    inputPerMillion: Number(inputPerMillion),
    outputPerMillion: Number(outputPerMillion),
    cachePerMillion: Number(cachePerMillion || 0),
    displayName: displayName || null,
    currency: currency || "CNY",
    deprecated: false,
    syncedAt: null,
    updatedBy: "manual",
    updatedAt: now,
    createdAt: now,
  });
  await saveDb();

  return NextResponse.json({ success: true, id });
});

/** 更新模型价格 */
export const PUT = apiHandler(async (request: NextRequest) => {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const body = await request.json();
  const { id, inputPerMillion, outputPerMillion, cachePerMillion, displayName, deprecated } = body;
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const { db } = await getDb();
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (inputPerMillion !== undefined) updateData.inputPerMillion = inputPerMillion;
  if (outputPerMillion !== undefined) updateData.outputPerMillion = outputPerMillion;
  if (cachePerMillion !== undefined) updateData.cachePerMillion = cachePerMillion;
  if (displayName !== undefined) updateData.displayName = displayName;
  if (deprecated !== undefined) updateData.deprecated = deprecated;
  // 手动编辑时清除 syncedAt，标记为手动管理
  updateData.syncedAt = null;
  updateData.updatedBy = "manual";

  await db.update(modelPrices).set(updateData).where(eq(modelPrices.id, id));
  await saveDb();

  return NextResponse.json({ success: true });
});

/** 删除模型价格 */
export const DELETE = apiHandler(async (request: NextRequest) => {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const { db, sqlite } = await getDb();

  // 查找该价格
  const rows = await db.select().from(modelPrices).where(eq(modelPrices.id, id)).limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "价格不存在" }, { status: 404 });
  }

  const price = rows[0];

  // TXN-02: 黑名单插入 + 价格删除包裹在事务中
  const sqliteAny = sqlite as unknown as SqliteExec & { exec(sql: string, params?: unknown[]): void };
  try {
    sqliteAny.exec(`BEGIN TRANSACTION`);
    // 加入同步黑名单（全局和渠道级都加入）
    await db.insert(syncBlacklist).values({
      model: price.model,
      channelId: price.channelId || null,  // NULL = 全局黑名单
      createdAt: new Date(),
    }).onConflictDoNothing();

    await db.delete(modelPrices).where(eq(modelPrices.id, id));
    sqliteAny.exec(`COMMIT`);
  } catch (err) {
    try { sqliteAny.exec(`ROLLBACK`); } catch {}
    console.error("[Prices] DELETE 事务失败，已回滚:", err);
    return NextResponse.json({ error: "删除失败，请稍后重试" }, { status: 500 });
  }

  await saveDb();

  return NextResponse.json({ success: true });
});
