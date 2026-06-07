import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb, resetDb, type SqliteExec } from "../../../../lib/db";
import { requireAdmin } from "../../../../lib/admin-check";
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";
import { pinyin } from "pinyin-pro";
import { searchableHash, ensureEncrypted } from "../../../../lib/crypto";
import { ADMIN_IDS, DEPT_DATA, DEPT_ACTIVITY } from "./seed-data";
import { generateUsageLogs } from "./generate-usage";

/**
 * 用真实飞书通讯录数据重新填充模拟数据
 * POST /api/setup/seed → 删除旧库 + 重建 + 填充
 * Body: { force?: boolean }  生产环境需 force=true
 * ⚠️ 高危端点：需要管理员鉴权，生产环境需额外 force 参数
 */
export async function POST(request: NextRequest) {
  // 鉴权：仅管理员可访问
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  let forceOverride = false;
  try {
    const body = await request.json();
    forceOverride = !!body.force;
  } catch {
    // 无 body 也行（默认不强制）
  }

  if (process.env.NODE_ENV === "production" && !forceOverride) {
    return NextResponse.json({ error: "Add { force: true } to seed in production" }, { status: 403 });
  }

  // ===== 强制删除旧数据库文件 =====
  resetDb();
  const dbPath = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes(":")
    ? process.env.DATABASE_URL
    : process.env.RAILWAY_VOLUME_MOUNT_PATH
      ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/data.db`
      : "./data.db";
  const absPath = path.resolve(dbPath);
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch {}

  const { sqlite } = await getDb();
  const dbAny = sqlite as unknown as SqliteExec;

  // ===== 建表 =====
  dbAny.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, feishu_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    avatar TEXT, email TEXT, department TEXT, department_id TEXT,
    group_name TEXT, group_id TEXT, center_name TEXT, center_id TEXT,
    employee_id TEXT, api_key TEXT NOT NULL UNIQUE,
    api_key_hash TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active', monthly_quota REAL DEFAULT 200,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE TABLE channels (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
    api_key TEXT NOT NULL, models TEXT NOT NULL DEFAULT '[]',
    priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
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
  dbAny.exec(`CREATE TABLE usage_logs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0, cost REAL DEFAULT 0, channel_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE TABLE quota_rules (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, target_id TEXT NOT NULL,
    monthly_limit REAL NOT NULL, updated_by TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE TABLE alert_logs (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, target_id TEXT NOT NULL,
    message TEXT NOT NULL, sent_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE TABLE IF NOT EXISTS alert_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE TABLE admin_logs (
    id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL,
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)`);
  dbAny.exec(`CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash)`);
  dbAny.exec(`CREATE INDEX IF NOT EXISTS idx_users_feishu_id ON users(feishu_id)`);
  dbAny.exec(`CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id)`);
  dbAny.exec(`CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at)`);

  // ===== 模型价格表 =====
  dbAny.exec(`CREATE TABLE model_prices (
    id TEXT PRIMARY KEY, model TEXT NOT NULL, channel_id TEXT,
    input_per_million REAL NOT NULL, output_per_million REAL NOT NULL,
    cache_per_million REAL NOT NULL DEFAULT 0, display_name TEXT,
    currency TEXT NOT NULL DEFAULT 'CNY',
    deprecated INTEGER NOT NULL DEFAULT 0, synced_at INTEGER,
    updated_by TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_channel_model ON model_prices(channel_id, model)`);
  dbAny.exec(`CREATE INDEX IF NOT EXISTS idx_model_prices_model ON model_prices(model)`);

  // ===== 同步黑名单 =====
  dbAny.exec(`CREATE TABLE IF NOT EXISTS sync_blacklist (
    model TEXT NOT NULL, channel_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (model, channel_id)
  ) WITHOUT ROWID`);

  // ===== 插入用户 =====
  const now = Math.floor(Date.now() / 1000);
  const regTs = now - 90 * 86400;
  let userIdx = 0;

  for (const dept of DEPT_DATA) {
    for (const m of dept.members) {
      const uid = `u_${String(userIdx++).padStart(3, "0")}`;
      const isAdmin = ADMIN_IDS.includes(m.fid);
      const emailPrefix = m.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || `user${userIdx}`;
      const namePinyin = pinyin(m.name || "", { toneType: "none", type: "array" }).join("").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || `user${userIdx}`;
      const apiKey = `sk-${namePinyin}-${randomBytes(6).toString("hex")}`;
      const apiKeyHash = searchableHash(apiKey);
      dbAny.exec(
        `INSERT INTO users (id, feishu_id, name, avatar, email, department, department_id, group_name, group_id, center_name, center_id, employee_id, api_key, api_key_hash, role, status, monthly_quota, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, '', ?, ?, ?, 'active', ?, ?, ?)`,
        [uid, m.fid, m.name, `${emailPrefix}@company.com`, dept.dept, dept.deptId, apiKey, apiKeyHash, isAdmin ? "admin" : "member", m.quota || 200, regTs, regTs]
      );
    }
  }

  // 何广明固定 API Key（方便 dev-login）
  const devKey = "sk-heguangming-dev-key";
  dbAny.exec(`UPDATE users SET api_key = ?, api_key_hash = ? WHERE feishu_id = 'ou_f2e284bb6701647e664c938806b08627'`, [devKey, searchableHash(devKey)]);

  // ===== 渠道 =====（API Key 加密存储）
  const chCols = "(id, name, base_url, api_key, models, priority, status, created_at, currency, provider)";
  dbAny.exec(`INSERT INTO channels ${chCols} VALUES ('ch_deepseek', 'DeepSeek 官方', 'https://api.deepseek.com', ?, '["deepseek-chat","deepseek-reasoner","deepseek-v4-flash","deepseek-v4-pro"]', 0, 'active', ?, 'CNY', 'deepseek')`, [ensureEncrypted('YOUR_DEEPSEEK_API_KEY'), regTs]);
  dbAny.exec(`INSERT INTO channels ${chCols} VALUES ('ch_silicon', '硅基流动', 'https://api.siliconflow.cn', ?, '["deepseek-ai/deepseek-chat-v3-0324"]', 1, 'active', ?, 'CNY', 'siliconflow')`, [ensureEncrypted('YOUR_SILICONFLOW_API_KEY'), regTs]);
  dbAny.exec(`INSERT INTO channels ${chCols} VALUES ('ch_glm', '智谱 GLM', 'https://open.bigmodel.cn/api/paas/v4', ?, '["glm-5.1","glm-4-plus","glm-4-flash"]', 2, 'active', ?, 'CNY', 'glm')`, [ensureEncrypted('YOUR_GLM_API_KEY'), regTs]);
  dbAny.exec(`INSERT INTO channels ${chCols} VALUES ('ch_openai', 'OpenAI 官方', 'https://api.openai.com', ?, '["gpt-5.5","gpt-4o","gpt-4o-mini"]', 3, 'active', ?, 'USD', 'openai')`, [ensureEncrypted('YOUR_OPENAI_API_KEY'), regTs]);
  dbAny.exec(`INSERT INTO channels ${chCols} VALUES ('ch_anthropic', 'Anthropic Claude', 'https://api.anthropic.com', ?, '["claude-opus-4-8","claude-sonnet-4-6"]', 4, 'active', ?, 'USD', 'anthropic')`, [ensureEncrypted('YOUR_ANTHROPIC_API_KEY'), regTs]);

  // ===== 生成 30 天 usage_logs =====
  const allUsers = dbAny.exec(`SELECT id, department, role FROM users`);
  const userRows: { id: string; dept: string; role: string; act: number }[] = (allUsers[0]?.values ?? []).map((r: unknown[]) => {
    const dept = String(r[1]);
    const role = String(r[2]);
    let act = DEPT_ACTIVITY[dept] || 0.5;
    if (role === "admin") act = Math.max(act, 1.5);
    return { id: String(r[0]), dept, role, act };
  });

  const todayDate = new Date();
  const startDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - 29);
  const totalRecords = generateUsageLogs(dbAny, userRows, startDate);

  // ===== 限额规则 =====
  for (const dept of DEPT_DATA) {
    const limit = Math.round(dept.members.reduce((s, m) => s + (m.quota || 200), 0) * 1.2);
    dbAny.exec(`INSERT INTO quota_rules VALUES (?, 'department', ?, ?, 'u_000', ?)`,
      [`q_${dept.deptId}`, dept.deptId, limit, regTs]);
  }
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_company', 'company', 'all', 30000, 'u_000', ?)`, [regTs]);

  // ===== 预警记录 =====
  const alerts = [
    ["personal_80", "u_014", "王洪领本月用量已达限额的 80%"],
    ["dept_80", "dept_it", "IT部本月用量已达限额的 80%"],
    ["anomaly", "u_003", "陈焕杰出现异常用量：1小时内消耗 ¥18.5"],
  ];
  for (let i = 0; i < alerts.length; i++) {
    dbAny.exec(`INSERT INTO alert_logs VALUES (?, ?, ?, ?, ?)`, [`alert_${i}`, ...alerts[i], now - (15 - i * 4) * 86400]);
  }

  // ===== 预警默认设置 =====
  const defaultSettings: [string, string][] = [
    ["personal_threshold", "80"],
    ["dept_threshold", "80"],
    ["company_threshold", "90"],
    ["anomaly_threshold", "10"],
    ["feishu_webhook_url", ""],
    ["feishu_notify_enabled", "false"],
    ["feishu_notify_types", "personal_80,personal_100,dept_80,company_90,anomaly"],
  ];
  for (let i = 0; i < defaultSettings.length; i++) {
    const [key, value] = defaultSettings[i];
    dbAny.exec(`INSERT OR IGNORE INTO alert_settings (key, value, updated_at) VALUES (?, ?, ?)`,
      [key, value, now]);
  }

  // ===== 操作日志 =====
  const logs = [
    ["sync_feishu", "system", "all", '{"departments":13,"users":153}'],
    ["update_quota", "department", "dept_it", '{"from":5000,"to":6000}'],
    ["create_channel", "channel", "ch_silicon", '{"name":"硅基流动"}'],
    ["export_report", "report", "monthly_202605", '{"month":"2026-05"}'],
  ];
  for (let i = 0; i < logs.length; i++) {
    dbAny.exec(`INSERT INTO admin_logs VALUES (?, 'u_000', ?, ?, ?, ?, ?)`, [`alog_${i}`, ...logs[i], now - (20 - i * 5) * 86400]);
  }

  // ===== 模型价格种子数据 =====
  const seedPrices: [string, string, number, number, number, string, number][] = [
    ["mp_flash", "deepseek-v4-flash", 1.0, 2.0, 0.02, "DeepSeek V4 Flash", 0],
    ["mp_pro", "deepseek-v4-pro", 3.0, 6.0, 0.025, "DeepSeek V4 Pro", 0],
    ["mp_chat", "deepseek-chat", 1.0, 2.0, 0.1, "DeepSeek Chat (旧版)", 1],
    ["mp_reasoner", "deepseek-reasoner", 4.0, 16.0, 0.4, "DeepSeek Reasoner (旧版)", 1],
    ["mp_glm51", "glm-5.1", 6.0, 24.0, 0.5, "GLM-5.1", 0],
    ["mp_glm4plus", "glm-4-plus", 50.0, 50.0, 0, "GLM-4 Plus", 0],
    ["mp_glm4flash", "glm-4-flash", 0.1, 0.1, 0, "GLM-4 Flash", 0],
    ["mp_gpt55", "gpt-5.5", 36.0, 216.0, 3.6, "GPT-5.5", 0],
    ["mp_gpt4o", "gpt-4o", 17.5, 60.0, 1.75, "GPT-4o", 0],
    ["mp_gpt4omini", "gpt-4o-mini", 1.05, 4.2, 0.105, "GPT-4o Mini", 0],
    ["mp_opus48", "claude-opus-4-8", 36.0, 180.0, 3.6, "Claude Opus 4.8", 0],
    ["mp_sonnet46", "claude-sonnet-4-6", 14.0, 70.0, 1.4, "Claude Sonnet 4.6", 0],
  ];
  for (const [id, model, input, output, cache, displayName, deprecated] of seedPrices) {
    dbAny.exec(
      `INSERT INTO model_prices (id, model, channel_id, input_per_million, output_per_million, cache_per_million, display_name, deprecated, synced_at, updated_at, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, model, input, output, cache, displayName, deprecated, now, now, now]
    );
  }

  await saveDb();
  resetDb();

  const totalUsers = userRows.length;
  return NextResponse.json({
    success: true,
    message: "153人完整通讯录模拟数据已填充",
    stats: {
      users: totalUsers,
      departments: DEPT_DATA.length,
      deptBreakdown: DEPT_DATA.map(d => `${d.dept}: ${d.members.length}人`).join(", "),
      usageLogs: totalRecords,
      channels: 5,
      quotaRules: DEPT_DATA.length + 1,
    },
  });
}
