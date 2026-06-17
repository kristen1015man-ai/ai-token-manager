import initSqlJs from "sql.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const DB_PATH = path.resolve(import.meta.dirname, "data.db");

// ===== 模拟数据配置 =====
const DEPARTMENTS = [
  { id: "dept_dev", name: "研发部" },
  { id: "dept_mkt", name: "市场部" },
  { id: "dept_design", name: "设计部" },
  { id: "dept_ops", name: "运营部" },
];

const MOCK_USERS = [
  { id: "u_admin", feishuId: "dev_admin", name: "张明（管理员）", email: "zhangming@company.com", dept: "研发部", deptId: "dept_dev", empId: "EMP001", role: "admin", quota: 500 },
  { id: "u_dev_wang", feishuId: "feishu_wang", name: "王工", email: "wang@company.com", dept: "研发部", deptId: "dept_dev", empId: "EMP002", role: "member", quota: 400 },
  { id: "u_dev_li", feishuId: "feishu_li", name: "李工", email: "li@company.com", dept: "研发部", deptId: "dept_dev", empId: "EMP003", role: "member", quota: 300 },
  { id: "u_mkt_chen", feishuId: "feishu_chen", name: "陈经理", email: "chen@company.com", dept: "市场部", deptId: "dept_mkt", empId: "EMP004", role: "member", quota: 350 },
  { id: "u_mkt_zhao", feishuId: "feishu_zhao", name: "赵策划", email: "zhao@company.com", dept: "市场部", deptId: "dept_mkt", empId: "EMP005", role: "member", quota: 250 },
  { id: "u_design_sun", feishuId: "feishu_sun", name: "孙设计", email: "sun@company.com", dept: "设计部", deptId: "dept_design", empId: "EMP006", role: "member", quota: 200 },
  { id: "u_design_zhou", feishuId: "feishu_zhou", name: "周设计", email: "zhou@company.com", dept: "设计部", deptId: "dept_design", empId: "EMP007", role: "member", quota: 200 },
  { id: "u_ops_wu", feishuId: "feishu_wu", name: "吴运营", email: "wu@company.com", dept: "运营部", deptId: "dept_ops", empId: "EMP008", role: "member", quota: 250 },
];

const CHANNELS = [
  { id: "ch_deepseek", name: "DeepSeek 官方", baseUrl: "https://api.deepseek.com", apiKey: "YOUR_DEEPSEEK_API_KEY", models: ["deepseek-chat", "deepseek-reasoner"], priority: 0 },
  { id: "ch_silicon", name: "硅基流动", baseUrl: "https://api.siliconflow.cn", apiKey: "YOUR_SILICONFLOW_API_KEY", models: ["deepseek-ai/deepseek-chat-v3-0324", "Pro/deepseek-ai/deepseek-r1"], priority: 1 },
];

const MODELS = [
  { name: "deepseek-chat", inputPrice: 0.001, outputPrice: 0.002, weight: 0.55 },
  { name: "deepseek-reasoner", inputPrice: 0.004, outputPrice: 0.016, weight: 0.15 },
  { name: "deepseek-ai/deepseek-chat-v3-0324", inputPrice: 0.0008, outputPrice: 0.0016, weight: 0.2 },
  { name: "Pro/deepseek-ai/deepseek-r1", inputPrice: 0.003, outputPrice: 0.012, weight: 0.1 },
];

// 简易伪随机（可重复）
let seed = 42;
function rand() {
  seed = (seed * 16807 + 0) % 2147483647;
  return (seed - 1) / 2147483646;
}
function randInt(min: number, max: number) {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function randFloat(min: number, max: number) {
  return rand() * (max - min) + min;
}
function pickWeighted<T>(items: { item: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rand() * total;
  for (const { item, weight } of items) {
    r -= weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1].item;
}

async function seedMock() {
  console.log("🗑️  删除旧数据库...");
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // ===== 建表 =====
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

  // ===== 插入用户 =====
  console.log("👤 插入 8 个员工...");
  const userCreateTs = Math.floor(Date.now() / 1000) - 90 * 86400; // 90天前注册
  for (const u of MOCK_USERS) {
    const apiKey = `sk-emp-${crypto.randomBytes(8).toString("hex")}`;
    db.run(
      `INSERT INTO users VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [u.id, u.feishuId, u.name, u.email, u.dept, u.deptId, u.empId, apiKey, u.role, u.quota, userCreateTs, userCreateTs]
    );
  }
  // 确保管理员 api_key 和 dev-login 一致
  db.run(`UPDATE users SET api_key = 'sk-emp-test12345678' WHERE id = 'u_admin'`);

  // ===== 插入渠道 =====
  console.log("📡 插入 2 个渠道...");
  const channelTs = Math.floor(Date.now() / 1000) - 60 * 86400;
  for (const ch of CHANNELS) {
    db.run(
      `INSERT INTO channels VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      [ch.id, ch.name, ch.baseUrl, ch.apiKey, JSON.stringify(ch.models), ch.priority, channelTs]
    );
  }

  // ===== 生成 usage_logs =====
  console.log("📊 生成 30 天使用记录...");
  const now = new Date();
  // 从今天往前推 30 天（包含今天）
  const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  let totalRecords = 0;
  let totalCost = 0;

  // 每个用户有不同的活跃度
  const userActivity: Record<string, number> = {
    u_admin: 1.5,      // 管理员重度使用
    u_dev_wang: 2.0,   // 研发主力
    u_dev_li: 1.0,     // 一般使用
    u_mkt_chen: 1.2,   // 市场经理
    u_mkt_zhao: 0.8,   // 一般
    u_design_sun: 0.6, // 偶尔用
    u_design_zhou: 0.5, // 偶尔用
    u_ops_wu: 1.1,     // 运营日常
  };

  // 当天数据额外加密（确保今天的 dashboard 有丰富数据）
  const todayBoost = 8.0; // 今天的数据量倍增（让本月仪表盘数据丰富）

  // 渠道分布权重
  const channelWeights = [
    { item: "ch_deepseek", weight: 0.7 },
    { item: "ch_silicon", weight: 0.3 },
  ];

  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    const day = new Date(thirtyDaysAgo.getTime() + dayOffset * 86400 * 1000);
    const dayOfWeek = day.getDay(); // 0=周日, 6=周六
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isToday = dayOffset === 29;

    // 工作日基础请求数 30-50，周末 5-15
    const baseRequests = isWeekend ? randInt(5, 15) : randInt(30, 50);

    for (const user of MOCK_USERS) {
      const activity = userActivity[user.id] || 0.5;
      // 活跃度 * 基础数 = 该用户今天的请求数
      const boost = isToday ? todayBoost : 1.0;
      const userRequests = Math.round(baseRequests * activity * (0.6 + rand() * 0.8) * boost);

      for (let r = 0; r < userRequests; r++) {
        // 工作时间 9-20 点高峰，深夜极少
        let hour: number;
        const hourRand = rand();
        if (hourRand < 0.05) {
          hour = randInt(0, 7);       // 深夜 5%
        } else if (hourRand < 0.15) {
          hour = randInt(8, 8);       // 早上 10%
        } else if (hourRand < 0.75) {
          hour = randInt(9, 17);      // 工作时间 60%
        } else if (hourRand < 0.90) {
          hour = randInt(18, 20);     // 晚间 15%
        } else {
          hour = randInt(21, 23);     // 深夜 10%
        }

        // 模拟数据覆盖全天 24 小时（不限制到当前时间）

        const minute = randInt(0, 59);
        const second = randInt(0, 59);
        const ts = Math.floor(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, second).getTime() / 1000);

        // 选择模型
        const model = pickWeighted(MODELS.map(m => ({ item: m, weight: m.weight })));

        // Token 数量：研发用多，其他人少
        const isDev = user.dept === "研发部";
        const inputTokens = isDev
          ? randInt(800, 6000)
          : randInt(300, 4000);
        const outputTokens = isDev
          ? randInt(500, 4000)
          : randInt(200, 2500);
        const totalTokens = inputTokens + outputTokens;

        // 计算费用（每百万 token 的价格）
        const cost = Number(((inputTokens * model.inputPrice + outputTokens * model.outputPrice) / 1000).toFixed(4));
        totalCost += cost;

        // 选择渠道
        const channelId = pickWeighted(channelWeights);

        const logId = crypto.randomBytes(8).toString("hex");
        db.run(
          `INSERT INTO usage_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [logId, user.id, model.name, inputTokens, outputTokens, totalTokens, cost, channelId, ts]
        );
        totalRecords++;
      }
    }
  }

  console.log(`  ✅ 共 ${totalRecords} 条记录，总费用 ¥${totalCost.toFixed(2)}`);

  // ===== 插入限额规则 =====
  console.log("🛡️ 插入限额规则...");
  const quotaTs = Math.floor(Date.now() / 1000) - 30 * 86400;

  // 公司级
  db.run(`INSERT INTO quota_rules VALUES (?, 'company', 'all', 20000, 'u_admin', ?)`,
    [crypto.randomUUID(), quotaTs]);

  // 部门级
  for (const dept of DEPARTMENTS) {
    const limit = dept.id === "dept_dev" ? 8000 : dept.id === "dept_mkt" ? 5000 : dept.id === "dept_design" ? 3000 : 4000;
    db.run(`INSERT INTO quota_rules VALUES (?, 'department', ?, ?, 'u_admin', ?)`,
      [crypto.randomUUID(), dept.id, limit, quotaTs]);
  }

  // 个人级（已经存在 users.monthly_quota，额外加几条规则）
  db.run(`INSERT INTO quota_rules VALUES (?, 'personal', 'u_dev_wang', 400, 'u_admin', ?)`,
    [crypto.randomUUID(), quotaTs]);
  db.run(`INSERT INTO quota_rules VALUES (?, 'personal', 'u_mkt_chen', 350, 'u_admin', ?)`,
    [crypto.randomUUID(), quotaTs]);

  // ===== 插入预警记录 =====
  console.log("🔔 插入预警记录...");
  const alertMessages = [
    { type: "personal_80", targetId: "u_dev_wang", msg: "王工本月用量已达限额的 80%（¥320/¥400）" },
    { type: "personal_100", targetId: "u_dev_wang", msg: "王工本月用量已达限额 100%（¥400/¥400），已暂停服务" },
    { type: "dept_80", targetId: "dept_dev", msg: "研发部本月用量已达限额的 80%" },
    { type: "personal_80", targetId: "u_admin", msg: "张明（管理员）本月用量已达限额的 80%（¥400/¥500）" },
    { type: "anomaly", targetId: "u_mkt_zhao", msg: "赵策划出现异常用量：1小时内消耗 ¥15.2，超出日常均值 5 倍" },
  ];

  for (let i = 0; i < alertMessages.length; i++) {
    const a = alertMessages[i];
    // 分散在过去 15 天
    const alertTs = Math.floor(Date.now() / 1000) - (15 - i * 3) * 86400 - randInt(0, 86400);
    db.run(`INSERT INTO alert_logs VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), a.type, a.targetId, a.msg, alertTs]);
  }

  // ===== 插入操作日志 =====
  console.log("📋 插入操作日志...");
  const adminActions = [
    { action: "update_quota", target_type: "user", target_id: "u_dev_wang", detail: JSON.stringify({ from: 200, to: 400 }) },
    { action: "create_channel", target_type: "channel", target_id: "ch_silicon", detail: JSON.stringify({ name: "硅基流动" }) },
    { action: "update_quota", target_type: "department", target_id: "dept_dev", detail: JSON.stringify({ from: 5000, to: 8000 }) },
    { action: "disable_user", target_type: "user", target_id: "u_design_zhou", detail: JSON.stringify({ reason: "长期未使用" }) },
    { action: "enable_user", target_type: "user", target_id: "u_design_zhou", detail: JSON.stringify({ reason: "恢复使用" }) },
    { action: "export_report", target_type: "report", target_id: "monthly_202605", detail: JSON.stringify({ month: "2026-05" }) },
    { action: "update_alert_config", target_type: "system", target_id: "alert_config", detail: JSON.stringify({ personal_threshold: 80 }) },
  ];

  for (let i = 0; i < adminActions.length; i++) {
    const a = adminActions[i];
    const logTs = Math.floor(Date.now() / 1000) - (20 - i * 2) * 86400;
    db.run(`INSERT INTO admin_logs VALUES (?, 'u_admin', ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), a.action, a.target_type, a.target_id, a.detail, logTs]);
  }

  // ===== 保存数据库 =====
  console.log("💾 保存数据库...");
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));

  // ===== 打印统计 =====
  console.log("\n📊 数据统计：");
  const userCount = db.exec("SELECT COUNT(*) FROM users");
  const channelCount = db.exec("SELECT COUNT(*) FROM channels");
  const logCount = db.exec("SELECT COUNT(*) FROM usage_logs");
  const quotaCount = db.exec("SELECT COUNT(*) FROM quota_rules");
  const alertCount = db.exec("SELECT COUNT(*) FROM alert_logs");
  const adminLogCount = db.exec("SELECT COUNT(*) FROM admin_logs");

  console.log(`  用户: ${userCount[0]?.values[0]?.[0]}`);
  console.log(`  渠道: ${channelCount[0]?.values[0]?.[0]}`);
  console.log(`  使用记录: ${logCount[0]?.values[0]?.[0]}`);
  console.log(`  限额规则: ${quotaCount[0]?.values[0]?.[0]}`);
  console.log(`  预警记录: ${alertCount[0]?.values[0]?.[0]}`);
  console.log(`  操作日志: ${adminLogCount[0]?.values[0]?.[0]}`);

  // 本月总费用
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  const monthCost = db.exec("SELECT SUM(cost) FROM usage_logs WHERE created_at >= ?", [monthStart]);
  console.log(`  本月总费用: ¥${Number(monthCost[0]?.values[0]?.[0] ?? 0).toFixed(2)}`);

  console.log(`\n✅ 数据库已保存到 ${DB_PATH} (${fs.statSync(DB_PATH).size / 1024 / 1024} MB)`);
  db.close();
}

seedMock().catch((e) => console.error("Seed error:", e));
