import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb, type SqliteExec } from "../../../../lib/db";
import { modelPrices, channels, syncBlacklist } from "../../../../../../shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { apiHandler, apiHandlerNoBody } from "../../../../lib/api-handler";

/** ensureTable 只执行一次（DDL 是幂等的，无需每次请求都跑） */
let tableEnsured = false;

/** 检查表中是否有某列 */
function hasColumn(sqlite: SqliteExec, table: string, col: string): boolean {
  const cols = sqlite.exec(`PRAGMA table_info(${table})`);
  return cols[0]?.values?.some((c) => c[1] === col) ?? false;
}

/** 确保 model_prices 表存在且有完整列 */
async function ensureTable(sqlite: SqliteExec) {
  if (tableEnsured) return;
  tableEnsured = true;

  // 创建表（如不存在）— 包含 currency 列
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS model_prices (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      channel_id TEXT,
      input_per_million REAL NOT NULL,
      output_per_million REAL NOT NULL,
      cache_per_million REAL NOT NULL DEFAULT 0,
      display_name TEXT,
      currency TEXT NOT NULL DEFAULT 'CNY',
      deprecated INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER,
      updated_by TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // 检查是否有 channel_id 列
  const hasChannelId = hasColumn(sqlite, "model_prices", "channel_id");
  if (!hasChannelId) {
    sqlite.exec(`
      CREATE TABLE model_prices_new (
        id TEXT PRIMARY KEY, model TEXT NOT NULL, channel_id TEXT,
        input_per_million REAL NOT NULL, output_per_million REAL NOT NULL,
        cache_per_million REAL NOT NULL DEFAULT 0, display_name TEXT,
        currency TEXT NOT NULL DEFAULT 'CNY',
        deprecated INTEGER NOT NULL DEFAULT 0, synced_at INTEGER,
        updated_by TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO model_prices_new SELECT id, model, NULL, input_per_million, output_per_million, cache_per_million, display_name, 'CNY', deprecated, synced_at, updated_by, updated_at, created_at FROM model_prices;
      DROP TABLE model_prices;
      ALTER TABLE model_prices_new RENAME TO model_prices;
    `);
  }

  // 检查是否有 currency 列（老表升级）
  if (!hasColumn(sqlite, "model_prices", "currency")) {
    sqlite.exec(`ALTER TABLE model_prices ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY'`);
  }

  // 唯一索引
  try { sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_channel_model ON model_prices(channel_id, model)"); } catch {}
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_mp_model ON model_prices(model)"); } catch {}

  // sync_blacklist 表 — 迁移到复合主键 (model, channel_id)
  const blHasChannelId = hasColumn(sqlite, "sync_blacklist", "channel_id");
  if (blHasChannelId) {
    // 已经是新版复合主键，确保表存在
    sqlite.exec(`CREATE TABLE IF NOT EXISTS sync_blacklist (model TEXT NOT NULL, channel_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (model, channel_id)) WITHOUT ROWID`);
  } else {
    // 检查旧版表是否存在
    const blExists = sqlite.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='sync_blacklist'`);
    if (blExists[0]?.values?.length) {
      // 旧版有数据，迁移到新版复合主键
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS sync_blacklist_new (model TEXT NOT NULL, channel_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (model, channel_id)) WITHOUT ROWID;
        INSERT OR IGNORE INTO sync_blacklist_new (model, channel_id, created_at) SELECT model, NULL, created_at FROM sync_blacklist;
        DROP TABLE sync_blacklist;
        ALTER TABLE sync_blacklist_new RENAME TO sync_blacklist;
      `);
    } else {
      // 全新创建
      sqlite.exec(`CREATE TABLE IF NOT EXISTS sync_blacklist (model TEXT NOT NULL, channel_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (model, channel_id)) WITHOUT ROWID`);
    }
  }

  // channels 表新增 currency 和 provider 列
  if (!hasColumn(sqlite, "channels", "currency")) {
    sqlite.exec(`ALTER TABLE channels ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY'`);
  }
  if (!hasColumn(sqlite, "channels", "provider")) {
    sqlite.exec(`ALTER TABLE channels ADD COLUMN provider TEXT`);
  }

  // 修复旧数据：seed 时 INSERT 没指定列名导致 currency 值为字面量 "currency"
  try {
    const bad = sqlite.exec(`SELECT COUNT(*) FROM channels WHERE currency = 'currency'`);
    if ((bad[0]?.values?.[0]?.[0] as number | undefined ?? 0) > 0) {
      // 根据渠道 id 判断正确币种
      sqlite.exec(`UPDATE channels SET currency = 'USD' WHERE id IN ('ch_openai', 'ch_anthropic') AND currency = 'currency'`);
      sqlite.exec(`UPDATE channels SET currency = 'CNY' WHERE currency = 'currency'`);
      console.log("[ensureTable] 已修复 channels.currency 错误值");
    }
  } catch {
    // 不影响启动
  }

  // 如果表为空，插入基础价格
  const count = sqlite.exec("SELECT COUNT(*) FROM model_prices");
  if (count[0]?.values?.[0]?.[0] === 0) {
    sqlite.exec(`
      INSERT OR IGNORE INTO model_prices (id, model, channel_id, input_per_million, output_per_million, cache_per_million, display_name, currency, deprecated, synced_at, updated_by, updated_at, created_at) VALUES
      ('price_ds_chat', 'deepseek-chat', NULL, 1.0, 2.0, 0.1, 'DeepSeek Chat', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_ds_reasoner', 'deepseek-reasoner', NULL, 4.0, 16.0, 0.4, 'DeepSeek Reasoner', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_ds_v3', 'deepseek-v3', NULL, 2.0, 8.0, 0.2, 'DeepSeek V3', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_glm4_flash', 'glm-4-flash', NULL, 0.1, 0.1, 0, 'GLM-4 Flash', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_glm4_plus', 'glm-4-plus', NULL, 50, 50, 0, 'GLM-4 Plus', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch())
    `);
  }
}

/** 获取所有模型价格 */
export const GET = apiHandlerNoBody(async () => {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db, sqlite } = await getDb();
  await ensureTable(sqlite as unknown as SqliteExec);

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
  } catch {
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

  const { db, sqlite } = await getDb();
  await ensureTable(sqlite as unknown as SqliteExec);

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

  // 加入同步黑名单（全局和渠道级都加入）
  try {
    await db.insert(syncBlacklist).values({
      model: price.model,
      channelId: price.channelId || null,  // NULL = 全局黑名单
      createdAt: new Date(),
    }).onConflictDoNothing();
  } catch {}

  await db.delete(modelPrices).where(eq(modelPrices.id, id));
  await saveDb();

  return NextResponse.json({ success: true });
});
