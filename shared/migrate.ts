import initSqlJs from "sql.js";
import * as fs from "fs";
import * as path from "path";

const DB_PATH = process.env.DATABASE_URL || "./data.db";

async function migrate() {
  console.log(`Initializing database at ${DB_PATH}...`);
  const absPath = path.resolve(DB_PATH);

  const SQL = await initSqlJs();

  let buffer: Buffer | undefined;
  if (fs.existsSync(absPath)) {
    buffer = fs.readFileSync(absPath);
  }

  const sqlite = buffer ? new SQL.Database(buffer) : new SQL.Database();

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
    `CREATE INDEX IF NOT EXISTS idx_quota_rules_scope_target ON quota_rules(scope, target_id)`,
  ];

  for (const stmt of statements) {
    sqlite.run(stmt);
  }

  // 保存到文件
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(absPath, Buffer.from(sqlite.export()));

  console.log("Database initialized successfully. Tables created:");
  console.log("  - users, channels, usage_logs, quota_rules, alert_logs, admin_logs");

  sqlite.close();
}

migrate().catch(console.error);
