import { getDb, saveDb, type SqliteExec } from "./db";
import { ensureEncrypted } from "./crypto";
import { ensureUserApiKeysTable, removeBackfilledDefaultApiKeys } from "./user-api-keys";

/** 允许 PRAGMA table_info 查询的表名白名单 */
const PRAGMA_TABLE_WHITELIST = new Set(["model_prices", "channels", "sync_blacklist", "usage_logs", "users", "user_api_keys"]);

/** 检查表中是否有某列 */
function hasColumn(sqlite: SqliteExec, table: string, col: string): boolean {
  if (!PRAGMA_TABLE_WHITELIST.has(table)) {
    throw new Error(`hasColumn: table "${table}" not in whitelist`);
  }
  const cols = sqlite.exec(`PRAGMA table_info(${table})`);
  return cols[0]?.values?.some((c) => c[1] === col) ?? false;
}

function ensureDefaultProviderChannels(dbRaw: SqliteExec): void {
  const placeholderKey = ensureEncrypted("placeholder-missing-provider-api-key");
  for (const channel of DEFAULT_PROVIDER_CHANNELS) {
    const exists = dbRaw.exec("SELECT COUNT(*) FROM channels WHERE id = ?", [channel.id]);
    const count = Number(exists[0]?.values?.[0]?.[0] ?? 0);
    if (count > 0) continue;

    dbRaw.run(
      `INSERT INTO channels
        (id, name, base_url, api_key, models, priority, status, currency, provider, balance_sync_mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'disabled', ?, ?, NULL, unixepoch())`,
      [
        channel.id,
        channel.name,
        channel.baseUrl,
        placeholderKey,
        JSON.stringify(channel.models),
        channel.priority,
        channel.currency,
        channel.provider,
      ]
    );
    console.log(`[ensureTables] restored disabled provider channel: ${channel.id}`);
  }
}

let ensured = false;

const DEFAULT_PROVIDER_CHANNELS = [
  {
    id: "ch_deepseek",
    name: "DeepSeek 官方",
    baseUrl: "https://api.deepseek.com",
    provider: "deepseek",
    currency: "CNY",
    priority: 0,
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "ch_glm",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    provider: "glm",
    currency: "CNY",
    priority: 2,
    models: ["glm-5.1", "glm-4-plus", "glm-4-flash"],
  },
  {
    id: "ch_openai",
    name: "OpenAI 官方",
    baseUrl: "https://api.openai.com",
    provider: "openai",
    currency: "USD",
    priority: 3,
    models: ["gpt-5.5", "gpt-4o", "gpt-4o-mini"],
  },
  {
    id: "ch_anthropic",
    name: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com",
    provider: "anthropic",
    currency: "USD",
    priority: 4,
    models: ["claude-opus-4-8", "claude-sonnet-4-6"],
  },
] as const;

/**
 * 启动时执行一次：确保所有辅助表存在且结构正确。
 * 从 GET 请求中迁移到启动阶段，避免首次请求延迟和并发 DDL 问题。
 */
export async function ensureAllTables() {
  if (ensured) return;
  ensured = true;

  const { sqlite } = await getDb();
  const dbRaw = sqlite as unknown as SqliteExec;

  console.log("[ensureTables] 检查并创建辅助表...");

  // ===== 安全检查：ENCRYPTION_KEY =====
  if (!process.env.ENCRYPTION_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[FATAL] ENCRYPTION_KEY must be configured in production");
    }
    console.warn("\n" + "=".repeat(60));
    console.warn("⚠️  安全警告：ENCRYPTION_KEY 未配置！");
    console.warn("   API Key、AK/SK 等敏感字段将以明文存储在数据库中");
    console.warn("   请在 .env.local 中设置 ENCRYPTION_KEY（64字符 hex）");
    console.warn("   生成命令: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
    console.warn("=".repeat(60) + "\n");
  } else {
    console.log("[ensureTables] ✅ ENCRYPTION_KEY 已配置，敏感字段将加密存储");
  }

  // ===== 核心表 =====
  dbRaw.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    feishu_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    avatar TEXT,
    email TEXT,
    department TEXT,
    department_id TEXT,
    group_name TEXT,
    group_id TEXT,
    center_name TEXT,
    center_id TEXT,
    employee_id TEXT,
    api_key TEXT NOT NULL UNIQUE,
    api_key_hash TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active',
    monthly_quota REAL DEFAULT 200,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  const userCoreCols: [string, string][] = [
    ["avatar", "TEXT"],
    ["email", "TEXT"],
    ["department", "TEXT"],
    ["department_id", "TEXT"],
    ["group_name", "TEXT"],
    ["group_id", "TEXT"],
    ["center_name", "TEXT"],
    ["center_id", "TEXT"],
    ["employee_id", "TEXT"],
    ["api_key_hash", "TEXT"],
    ["role", "TEXT NOT NULL DEFAULT 'member'"],
    ["status", "TEXT NOT NULL DEFAULT 'active'"],
    ["monthly_quota", "REAL DEFAULT 200"],
    ["created_at", "INTEGER"],
    ["updated_at", "INTEGER"],
  ];
  for (const [col, type] of userCoreCols) {
    if (!hasColumn(dbRaw, "users", col)) {
      dbRaw.exec(`ALTER TABLE users ADD COLUMN "${col}" ${type}`);
    }
  }
  dbRaw.exec(`CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash)`);
  dbRaw.exec(`CREATE INDEX IF NOT EXISTS idx_users_feishu_id ON users(feishu_id)`);

  ensureUserApiKeysTable(dbRaw);
  const removedDefaultKeys = removeBackfilledDefaultApiKeys(dbRaw);
  if (removedDefaultKeys > 0) {
    console.log(`[ensureTables] removed default user_api_keys: ${removedDefaultKeys}`);
  }
  dbRaw.exec(`
    CREATE TABLE IF NOT EXISTS system_flags (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  const explicitKeyResetFlag = dbRaw.exec(
    "SELECT value FROM system_flags WHERE key = 'user_api_keys_explicit_creation_reset_v1'"
  );
  if (!explicitKeyResetFlag[0]?.values?.length) {
    const existingKeyCount = dbRaw.exec("SELECT COUNT(*) FROM user_api_keys");
    const keysToRemove = Number(existingKeyCount[0]?.values?.[0]?.[0] ?? 0);
    if (keysToRemove > 0) {
      dbRaw.exec("DELETE FROM user_api_keys");
      console.log(`[ensureTables] cleared existing user_api_keys for explicit first creation: ${keysToRemove}`);
    }
    dbRaw.exec(
      "INSERT INTO system_flags (key, value, updated_at) VALUES ('user_api_keys_explicit_creation_reset_v1', 'done', unixepoch())"
    );
  }

  dbRaw.exec(`CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    models TEXT NOT NULL DEFAULT '[]',
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    currency TEXT NOT NULL DEFAULT 'CNY',
    provider TEXT,
    balance REAL,
    balance_currency TEXT,
    balance_sync_mode TEXT,
    balance_synced_at INTEGER,
    balance_alert_threshold REAL,
    access_key_id TEXT,
    access_key_secret TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  dbRaw.exec(`CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    channel_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  dbRaw.exec(`CREATE TABLE IF NOT EXISTS quota_rules (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    target_id TEXT NOT NULL,
    monthly_limit REAL NOT NULL,
    updated_by TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbRaw.exec(`CREATE TABLE IF NOT EXISTS quota_reservations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    department_id TEXT,
    channel_id TEXT,
    model TEXT,
    estimated_cost REAL NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`);
  dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_qr_user_expires ON quota_reservations(user_id, expires_at)");
  dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_qr_dept_expires ON quota_reservations(department_id, expires_at)");
  dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_qr_expires ON quota_reservations(expires_at)");
  dbRaw.exec(`
    UPDATE users
    SET monthly_quota = (
      SELECT qr.monthly_limit
      FROM quota_rules qr
      WHERE qr.scope = 'personal' AND qr.target_id = users.id
      ORDER BY qr.updated_at DESC
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1
      FROM quota_rules qr
      WHERE qr.scope = 'personal' AND qr.target_id = users.id
    )
  `);

  dbRaw.exec(`CREATE TABLE IF NOT EXISTS alert_logs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  dbRaw.exec(`CREATE TABLE IF NOT EXISTS admin_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  // ===== model_prices 表 =====
  dbRaw.exec(`
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

  // 检查 channel_id 列 — 事务保护迁移
  const hasChannelId = hasColumn(dbRaw, "model_prices", "channel_id");
  if (!hasChannelId) {
    try {
      dbRaw.exec(`BEGIN TRANSACTION`);
      dbRaw.exec(`
        CREATE TABLE model_prices_new (
          id TEXT PRIMARY KEY, model TEXT NOT NULL, channel_id TEXT,
          input_per_million REAL NOT NULL, output_per_million REAL NOT NULL,
          cache_per_million REAL NOT NULL DEFAULT 0, display_name TEXT,
          currency TEXT NOT NULL DEFAULT 'CNY',
          deprecated INTEGER NOT NULL DEFAULT 0, synced_at INTEGER,
          updated_by TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
      dbRaw.exec(`
        INSERT INTO model_prices_new SELECT id, model, NULL, input_per_million, output_per_million, cache_per_million, display_name, 'CNY', deprecated, synced_at, updated_by, updated_at, created_at FROM model_prices
      `);
      dbRaw.exec(`DROP TABLE model_prices`);
      dbRaw.exec(`ALTER TABLE model_prices_new RENAME TO model_prices`);
      dbRaw.exec(`COMMIT`);
    } catch (e) {
      try { dbRaw.exec(`ROLLBACK`); } catch {}
      console.error("[ensureTables] model_prices 迁移失败，已回滚:", e);
    }
  }

  // currency 列
  if (!hasColumn(dbRaw, "model_prices", "currency")) {
    dbRaw.exec(`ALTER TABLE model_prices ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY'`);
  }

  // 唯一索引
  try {
    dbRaw.exec(`
      DELETE FROM model_prices
      WHERE channel_id IS NULL
        AND rowid NOT IN (
          SELECT MAX(rowid)
          FROM model_prices
          WHERE channel_id IS NULL
          GROUP BY model
        )
    `);
    dbRaw.exec(`
      DELETE FROM model_prices
      WHERE channel_id IS NOT NULL
        AND rowid NOT IN (
          SELECT MAX(rowid)
          FROM model_prices
          WHERE channel_id IS NOT NULL
          GROUP BY channel_id, model
        )
    `);
    dbRaw.exec("DROP INDEX IF EXISTS idx_mp_channel_model");
    dbRaw.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_global_model ON model_prices(model) WHERE channel_id IS NULL");
    dbRaw.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_channel_model_not_null ON model_prices(channel_id, model) WHERE channel_id IS NOT NULL");
  } catch (err) {
    console.warn("[ensureTables] model_prices unique index migration skipped:", err);
  }
  try { dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_mp_model ON model_prices(model)"); } catch {}

  // ===== sync_blacklist 表 =====
  const blHasChannelId = hasColumn(dbRaw, "sync_blacklist", "channel_id");
  if (blHasChannelId) {
    dbRaw.exec(`CREATE TABLE IF NOT EXISTS sync_blacklist (model TEXT NOT NULL, channel_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (model, channel_id)) WITHOUT ROWID`);
  } else {
    const blExists = dbRaw.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='sync_blacklist'`);
    if (blExists[0]?.values?.length) {
      try {
        dbRaw.exec(`BEGIN TRANSACTION`);
        dbRaw.exec(`CREATE TABLE IF NOT EXISTS sync_blacklist_new (model TEXT NOT NULL, channel_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (model, channel_id)) WITHOUT ROWID`);
        dbRaw.exec(`INSERT OR IGNORE INTO sync_blacklist_new (model, channel_id, created_at) SELECT model, NULL, created_at FROM sync_blacklist`);
        dbRaw.exec(`DROP TABLE sync_blacklist`);
        dbRaw.exec(`ALTER TABLE sync_blacklist_new RENAME TO sync_blacklist`);
        dbRaw.exec(`COMMIT`);
      } catch (e) {
        try { dbRaw.exec(`ROLLBACK`); } catch {}
        console.error("[ensureTables] sync_blacklist 迁移失败，已回滚:", e);
      }
    } else {
      dbRaw.exec(`CREATE TABLE IF NOT EXISTS sync_blacklist (model TEXT NOT NULL, channel_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (model, channel_id)) WITHOUT ROWID`);
    }
  }

  // ===== channels 表辅助列 =====
  if (!hasColumn(dbRaw, "channels", "currency")) {
    dbRaw.exec(`ALTER TABLE channels ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY'`);
  }
  if (!hasColumn(dbRaw, "channels", "provider")) {
    dbRaw.exec(`ALTER TABLE channels ADD COLUMN provider TEXT`);
  }

  // 修复旧数据 currency 错误值
  try {
    const bad = dbRaw.exec(`SELECT COUNT(*) FROM channels WHERE currency = 'currency'`);
    if ((bad[0]?.values?.[0]?.[0] as number | undefined ?? 0) > 0) {
      dbRaw.exec(`UPDATE channels SET currency = 'USD' WHERE id IN ('ch_openai', 'ch_anthropic') AND currency = 'currency'`);
      dbRaw.exec(`UPDATE channels SET currency = 'CNY' WHERE currency = 'currency'`);
      console.log("[ensureTables] 已修复 channels.currency 错误值");
    }
  } catch (err) {
    console.warn("[ensureTables] currency 修复跳过:", err);
  }

  // ===== 种子价格数据 =====
  const count = dbRaw.exec("SELECT COUNT(*) FROM model_prices");
  if (count[0]?.values?.[0]?.[0] === 0) {
    dbRaw.exec(`
      INSERT OR IGNORE INTO model_prices (id, model, channel_id, input_per_million, output_per_million, cache_per_million, display_name, currency, deprecated, synced_at, updated_by, updated_at, created_at) VALUES
      ('price_ds_chat', 'deepseek-chat', NULL, 1.0, 2.0, 0.1, 'DeepSeek Chat', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_ds_reasoner', 'deepseek-reasoner', NULL, 4.0, 16.0, 0.4, 'DeepSeek Reasoner', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_ds_v3', 'deepseek-v3', NULL, 2.0, 8.0, 0.2, 'DeepSeek V3', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_glm4_flash', 'glm-4-flash', NULL, 0.1, 0.1, 0, 'GLM-4 Flash', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_glm4_plus', 'glm-4-plus', NULL, 50, 50, 0, 'GLM-4 Plus', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch())
    `);
  }

  // ===== usage_logs 索引（性能关键） =====
  // usage_logs 是查询最频繁的表，所有管理页面的聚合查询都依赖这些索引
  console.log("[ensureTables] 创建 usage_logs 索引...");
  dbRaw.exec(`
    INSERT OR IGNORE INTO model_prices
      (id, model, channel_id, input_per_million, output_per_million, cache_per_million, display_name, currency, deprecated, synced_at, updated_by, updated_at, created_at)
    VALUES
      ('price_ds_v4_flash', 'deepseek-v4-flash', NULL, 1.0, 2.0, 0.02, 'DeepSeek V4 Flash', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch()),
      ('price_ds_v4_pro', 'deepseek-v4-pro', NULL, 3.0, 6.0, 0.025, 'DeepSeek V4 Pro', 'CNY', 0, unixepoch(), 'seed', unixepoch(), unixepoch())
  `);

  try {
    const deepseekRows = dbRaw.exec("SELECT id, models FROM channels WHERE provider = 'deepseek' OR lower(base_url) LIKE '%deepseek%'");
    for (const row of deepseekRows[0]?.values ?? []) {
      const id = String(row[0]);
      let models: string[] = [];
      try {
        const parsed = JSON.parse(String(row[1] || "[]"));
        if (Array.isArray(parsed)) models = parsed.filter((m): m is string => typeof m === "string");
      } catch {}
      const nextModels = Array.from(new Set([...models, "deepseek-v4-pro", "deepseek-v4-flash"]));
      if (nextModels.length !== models.length) {
        dbRaw.exec("UPDATE channels SET models = ? WHERE id = ?", [JSON.stringify(nextModels), id]);
        console.log(`[ensureTables] added DeepSeek V4 models to channel: ${id}`);
      }
    }
  } catch (err) {
    console.warn("[ensureTables] DeepSeek V4 channel migration skipped:", err);
  }

  try { dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_ul_created_at ON usage_logs(created_at)"); } catch {}
  try { dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_ul_user_id ON usage_logs(user_id)"); } catch {}
  try { dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_ul_model ON usage_logs(model)"); } catch {}
  try { dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_ul_channel_id ON usage_logs(channel_id)"); } catch {}
  // 组合索引：覆盖最常用的 "按时间+按维度" 聚合查询
  try { dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_ul_model_created ON usage_logs(model, created_at)"); } catch {}
  try { dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_ul_channel_created ON usage_logs(channel_id, created_at)"); } catch {}
  try { dbRaw.exec("CREATE INDEX IF NOT EXISTS idx_ul_user_created ON usage_logs(user_id, created_at)"); } catch {}

  // ===== users 表组织架构列（从 departments/employees 路由迁移到启动时） =====
  const userOrgCols: [string, string][] = [
    ["center", "TEXT"],
    ["group", "TEXT"],
    ["department", "TEXT"],
    ["department_id", "TEXT"],
    ["group_name", "TEXT"],
    ["group_id", "TEXT"],
    ["center_name", "TEXT"],
    ["center_id", "TEXT"],
  ];
  for (const [col, type] of userOrgCols) {
    if (!hasColumn(dbRaw, "users", col)) {
      dbRaw.exec(`ALTER TABLE users ADD COLUMN "${col}" ${type}`);
    }
  }

  // ===== channels 表余额相关列（从 channels 路由迁移到启动时） =====
  const channelBalanceCols: [string, string][] = [
    ["balance", "REAL"],
    ["balance_currency", "TEXT"],
    ["balance_sync_mode", "TEXT"],
    ["balance_synced_at", "INTEGER"],
    ["balance_alert_threshold", "REAL"],
    ["access_key_id", "TEXT"],
    ["access_key_secret", "TEXT"],
  ];
  for (const [col, type] of channelBalanceCols) {
    if (!hasColumn(dbRaw, "channels", col)) {
      dbRaw.exec(`ALTER TABLE channels ADD COLUMN ${col} ${type}`);
    }
  }

  ensureDefaultProviderChannels(dbRaw);

  console.log("[ensureTables] 辅助表检查完成");
  await saveDb();
}
