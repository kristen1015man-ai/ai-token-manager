import initSqlJs from "sql.js";
import * as fs from "fs";
import * as path from "path";

const DB_PATH = path.resolve(import.meta.dirname, "data.db");

async function seed() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // 建表
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, feishu_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    avatar TEXT, email TEXT, department TEXT, department_id TEXT,
    group_name TEXT, group_id TEXT,
    center_name TEXT, center_id TEXT,
    employee_id TEXT,
    api_key TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active', monthly_quota REAL DEFAULT 200,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
    api_key TEXT NOT NULL, models TEXT NOT NULL DEFAULT '[]',
    priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0, cost REAL DEFAULT 0, channel_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS quota_rules (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, target_id TEXT NOT NULL,
    monthly_limit REAL NOT NULL, updated_by TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS alert_logs (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, target_id TEXT NOT NULL,
    message TEXT NOT NULL, sent_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS admin_logs (
    id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL,
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  // Seed 测试数据
  db.run(`INSERT INTO users VALUES (
    'test001', 'test_fid', '测试用户', NULL, 'test@test.com', '研发部',
    NULL, 'EMP001', 'sk-emp-TESTKEY_ONLY_FOR_DEV', 'admin', 'active', 200,
    unixepoch(), unixepoch()
  )`);
  db.run(`INSERT INTO channels VALUES (
    'ch001', 'DeepSeek官方', 'https://api.deepseek.com', 'YOUR_DEEPSEEK_API_KEY_HERE',
    '["deepseek-chat","deepseek-reasoner"]', 0, 'active', unixepoch()
  )`);

  // 验证
  const users = db.exec("SELECT id, name, api_key FROM users");
  const channels = db.exec("SELECT id, name FROM channels");
  console.log("Users:", JSON.stringify(users[0]?.values));
  console.log("Channels:", JSON.stringify(channels[0]?.values));

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log(`DB saved to ${DB_PATH} (${fs.statSync(DB_PATH).size} bytes)`);
  db.close();
}

seed().catch((e) => console.error("Seed error:", e));
