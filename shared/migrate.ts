import initSqlJs from "sql.js";
import * as fs from "fs";
import * as path from "path";

const DB_PATH = process.env.DATABASE_URL || "./data.db";

// ========== 迁移版本号 ==========
// 每次新增迁移时递增，已执行过的迁移不会重复执行
const SCHEMA_VERSION = 4;

/**
 * 获取表的列名集合
 */
type SqlJsDatabase = InstanceType<(Awaited<ReturnType<typeof initSqlJs>>)["Database"]>;

/** 允许 PRAGMA table_info 查询的表名白名单 */
const ALLOWED_TABLES = new Set([
  "users", "channels", "usage_logs", "quota_rules", "alert_logs",
  "admin_logs", "model_prices", "sync_blacklist", "alert_settings", "_schema_version",
]);

function getTableColumns(sqlite: SqlJsDatabase, table: string): Set<string> {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`getTableColumns: table "${table}" not in whitelist`);
  }
  const result = sqlite.exec(`PRAGMA table_info(${table})`);
  if (!result[0]) return new Set();
  return new Set(result[0].values.map((r: unknown[]) => String(r[1])));
}

/**
 * 安全添加列（已存在则跳过）
 */
function addColumnIfMissing(
  sqlite: SqlJsDatabase,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = getTableColumns(sqlite, table);
  if (!cols.has(column)) {
    sqlite.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  [migrate] Added column ${table}.${column}`);
  }
}

async function migrate() {
  console.log(`Initializing database at ${DB_PATH}...`);
  const absPath = path.resolve(DB_PATH);

  const SQL = await initSqlJs();

  let buffer: Buffer | undefined;
  if (fs.existsSync(absPath)) {
    buffer = fs.readFileSync(absPath);
  }

  const sqlite = buffer ? new SQL.Database(buffer) : new SQL.Database();

  // INTG-01: 启用外键约束（建表阶段就要启用）
  sqlite.run("PRAGMA foreign_keys = ON");

  // ===== Step 1: 基础建表 =====
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
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
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      monthly_quota REAL DEFAULT 200,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,

    `CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      models TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,

    `CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      channel_id TEXT NOT NULL REFERENCES channels(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,

    `CREATE TABLE IF NOT EXISTS quota_rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      target_id TEXT NOT NULL,
      monthly_limit REAL NOT NULL,
      updated_by TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,

    `CREATE TABLE IF NOT EXISTS alert_logs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      message TEXT NOT NULL,
      sent_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,

    `CREATE TABLE IF NOT EXISTS admin_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,

    `CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)`,
    `CREATE INDEX IF NOT EXISTS idx_users_feishu_id ON users(feishu_id)`,
    `CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_usage_logs_model ON usage_logs(model)`,

    // 模型价格表（渠道+模型组合定价）
    `CREATE TABLE IF NOT EXISTS model_prices (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_channel_model ON model_prices(channel_id, model)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_model ON model_prices(model)`,

    // 同步黑名单（防止删除的模型被同步回来）
    `CREATE TABLE IF NOT EXISTS sync_blacklist (
      model TEXT NOT NULL,
      channel_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (model, channel_id)
    ) WITHOUT ROWID`,

    // 预警设置表
    `CREATE TABLE IF NOT EXISTS alert_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,

    // Schema 版本记录表
    `CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,

    `CREATE INDEX IF NOT EXISTS idx_quota_rules_scope_target ON quota_rules(scope, target_id)`,
  ];

  for (const stmt of statements) {
    sqlite.run(stmt);
  }

  // ===== Step 2: 版本化增量迁移 =====
  const currentVersion = (() => {
    try {
      const rows = sqlite.exec("SELECT MAX(version) FROM _schema_version");
      return (rows[0]?.values[0]?.[0] as number) ?? 0;
    } catch {
      return 0;
    }
  })();

  if (currentVersion < SCHEMA_VERSION) {
    console.log(`[migrate] Schema version ${currentVersion} → ${SCHEMA_VERSION}, running migrations...`);
  }

  // --- Migration v1: channels 余额 + supplier + accessKey 相关字段 ---
  if (currentVersion < 1) {
    console.log("[migrate] v1: Adding balance/provider/accessKey columns to channels...");
    addColumnIfMissing(sqlite, "channels", "currency", "TEXT NOT NULL DEFAULT 'CNY'");
    addColumnIfMissing(sqlite, "channels", "provider", "TEXT");
    addColumnIfMissing(sqlite, "channels", "balance", "REAL");
    addColumnIfMissing(sqlite, "channels", "balance_currency", "TEXT");
    addColumnIfMissing(sqlite, "channels", "balance_sync_mode", "TEXT");
    addColumnIfMissing(sqlite, "channels", "balance_synced_at", "INTEGER");
    addColumnIfMissing(sqlite, "channels", "balance_alert_threshold", "REAL");
    addColumnIfMissing(sqlite, "channels", "access_key_id", "TEXT");
    addColumnIfMissing(sqlite, "channels", "access_key_secret", "TEXT");
    sqlite.run("INSERT INTO _schema_version (version) VALUES (1)");
  }

  // --- Migration v2: model_prices 币种字段 ---
  if (currentVersion < 2) {
    console.log("[migrate] v2: Adding currency column to model_prices...");
    addColumnIfMissing(sqlite, "model_prices", "currency", "TEXT NOT NULL DEFAULT 'CNY'");
    sqlite.run("INSERT INTO _schema_version (version) VALUES (2)");
  }

  // --- Migration v3: users.api_key_hash（HMAC-SHA256 可搜索哈希） ---
  if (currentVersion < 3) {
    console.log("[migrate] v3: Adding api_key_hash column to users...");
    addColumnIfMissing(sqlite, "users", "api_key_hash", "TEXT");
    sqlite.run("CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash)");
    // 为已有用户回填 hash（读取 api_key 明文/密文 → 解密 → 算 hash）
    // 注意：这里无法调用 shared/crypto.ts 的 searchableHash（因为 migrate.ts 是独立脚本）
    // 回填逻辑在 web 端启动时自动执行
    sqlite.run("INSERT INTO _schema_version (version) VALUES (3)");
  }

  // --- Migration v4: 限额查询优化索引 ---
  if (currentVersion < 4) {
    console.log("[migrate] v4: Adding composite indexes for quota queries...");
    sqlite.run("CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created ON usage_logs(user_id, created_at)");
    sqlite.run("CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id)");
    sqlite.run("INSERT INTO _schema_version (version) VALUES (4)");
  }

  // --- 未来迁移在此追加 ---
  // if (currentVersion < 5) { ... }

  // 保存到文件
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(absPath, Buffer.from(sqlite.export()));

  console.log("Database initialized successfully. Tables created:");
  console.log("  - users, channels, usage_logs, quota_rules, alert_logs, admin_logs");
  console.log("  - model_prices, sync_blacklist, alert_settings");
  console.log(`  - Schema version: ${SCHEMA_VERSION}`);

  sqlite.close();
}

migrate().catch(console.error);
