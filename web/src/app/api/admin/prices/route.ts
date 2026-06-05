import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";
import { modelPrices, channels, syncBlacklist } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";

/** 确保 model_prices 表存在且有完整列 */
async function ensureTable(sqlite: any) {
  // 创建表（如不存在）
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS model_prices (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      channel_id TEXT,
      input_per_million REAL NOT NULL,
      output_per_million REAL NOT NULL,
      cache_per_million REAL NOT NULL DEFAULT 0,
      display_name TEXT,
      deprecated INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER,
      updated_by TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // 检查是否有 channel_id 列
  const cols = sqlite.exec("PRAGMA table_info(model_prices)");
  const hasChannelId = cols[0]?.values?.some((c: any[]) => c[1] === "channel_id");
  if (!hasChannelId) {
    // 迁移：重建表加 channel_id
    sqlite.exec(`
      CREATE TABLE model_prices_new (
        id TEXT PRIMARY KEY, model TEXT NOT NULL, channel_id TEXT,
        input_per_million REAL NOT NULL, output_per_million REAL NOT NULL,
        cache_per_million REAL NOT NULL DEFAULT 0, display_name TEXT,
        deprecated INTEGER NOT NULL DEFAULT 0, synced_at INTEGER,
        updated_by TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO model_prices_new SELECT id, model, NULL, input_per_million, output_per_million, cache_per_million, display_name, deprecated, synced_at, updated_by, updated_at, created_at FROM model_prices;
      DROP TABLE model_prices;
      ALTER TABLE model_prices_new RENAME TO model_prices;
    `);
  }

  // 唯一索引
  try { sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_channel_model ON model_prices(channel_id, model)"); } catch {}
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_mp_model ON model_prices(model)"); } catch {}

  // sync_blacklist 表
  sqlite.exec(`CREATE TABLE IF NOT EXISTS sync_blacklist (model TEXT PRIMARY KEY, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);

  // 如果表为空，插入基础价格
  const count = sqlite.exec("SELECT COUNT(*) FROM model_prices");
  if (count[0]?.values?.[0]?.[0] === 0) {
    sqlite.exec(`
      INSERT OR IGNORE INTO model_prices (id, model, channel_id, input_per_million, output_per_million, cache_per_million, display_name, deprecated, synced_at, updated_by, updated_at, created_at) VALUES
      ('price_ds_chat', 'deepseek-chat', NULL, 1.0, 2.0, 0.1, 'DeepSeek Chat', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_ds_reasoner', 'deepseek-reasoner', NULL, 4.0, 16.0, 0.4, 'DeepSeek Reasoner', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_ds_v3', 'deepseek-v3', NULL, 2.0, 8.0, 0.2, 'DeepSeek V3', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_glm4_flash', 'glm-4-flash', NULL, 0.1, 0.1, 0, 'GLM-4 Flash', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_glm4_plus', 'glm-4-plus', NULL, 50, 50, 0, 'GLM-4 Plus', 0, unixepoch(), 'seed', unixepoch(), unixepoch())
    `);
  }
}

/** 获取所有模型价格 */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db, sqlite } = await getDb();
  await ensureTable(sqlite);

  const priceList = await db.select().from(modelPrices);

  // 获取渠道列表用于显示名称
  const channelList = await db.select({ id: channels.id, name: channels.name }).from(channels);
  const channelMap = new Map(channelList.map((c) => [c.id, c.name]));

  return NextResponse.json({
    prices: priceList.map((p) => ({
      ...p,
      channelName: p.channelId ? (channelMap.get(p.channelId) || "未知渠道") : "全局（默认）",
    })),
  });
}

/** 更新模型价格 */
export async function PUT(request: NextRequest) {
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
}

/** 删除模型价格 */
export async function DELETE(request: NextRequest) {
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

  // 如果是全局价格，加入同步黑名单
  if (!price.channelId) {
    try {
      await db.insert(syncBlacklist).values({ model: price.model, createdAt: new Date() }).onConflictDoNothing();
    } catch {}
  }

  await db.delete(modelPrices).where(eq(modelPrices.id, id));
  await saveDb();

  return NextResponse.json({ success: true });
}
