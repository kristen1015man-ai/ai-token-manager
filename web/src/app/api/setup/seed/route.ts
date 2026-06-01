import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "../../../../lib/db";

/**
 * 初始化/重新填充模拟数据
 * 仅在 NODE_ENV !== production 或带 ?force=1 时可用
 * GET /api/setup/seed → 创建表 + 插入模拟数据
 */
export async function GET(request: NextRequest) {
  // 生产环境需要 force 参数才允许执行
  if (process.env.NODE_ENV === "production" && !request.nextUrl.searchParams.get("force")) {
    return NextResponse.json({ error: "Add ?force=1 to seed in production" }, { status: 403 });
  }

  const { sqlite } = await getDb();
  const dbAny = sqlite as any;

  // ===== 建表（如果不存在） =====
  dbAny.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, feishu_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    avatar TEXT, email TEXT, department TEXT, department_id TEXT, employee_id TEXT,
    api_key TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active', monthly_quota REAL DEFAULT 200,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
    api_key TEXT NOT NULL, models TEXT NOT NULL DEFAULT '[]',
    priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0, cost REAL DEFAULT 0, channel_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE TABLE IF NOT EXISTS quota_rules (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, target_id TEXT NOT NULL,
    monthly_limit REAL NOT NULL, updated_by TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE TABLE IF NOT EXISTS alert_logs (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, target_id TEXT NOT NULL,
    message TEXT NOT NULL, sent_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE TABLE IF NOT EXISTS admin_logs (
    id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL,
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  // ===== 清空旧数据 =====
  const tables = ["usage_logs", "quota_rules", "alert_logs", "admin_logs", "channels", "users"];
  for (const t of tables) {
    dbAny.exec(`DELETE FROM ${t}`);
  }

  // ===== 插入用户 =====
  const now = Math.floor(Date.now() / 1000);
  const regTs = now - 90 * 86400;
  const users = [
    ["u_admin", "dev_admin", "张明（管理员）", "zhangming@company.com", "研发部", "dept_dev", "EMP001", "admin", 500],
    ["u_dev_wang", "feishu_wang", "王工", "wang@company.com", "研发部", "dept_dev", "EMP002", "member", 400],
    ["u_dev_li", "feishu_li", "李工", "li@company.com", "研发部", "dept_dev", "EMP003", "member", 300],
    ["u_mkt_chen", "feishu_chen", "陈经理", "chen@company.com", "市场部", "dept_mkt", "EMP004", "member", 350],
    ["u_mkt_zhao", "feishu_zhao", "赵策划", "zhao@company.com", "市场部", "dept_mkt", "EMP005", "member", 250],
    ["u_design_sun", "feishu_sun", "孙设计", "sun@company.com", "设计部", "dept_design", "EMP006", "member", 200],
    ["u_design_zhou", "feishu_zhou", "周设计", "zhou@company.com", "设计部", "dept_design", "EMP007", "member", 200],
    ["u_ops_wu", "feishu_wu", "吴运营", "wu@company.com", "运营部", "dept_ops", "EMP008", "member", 250],
  ];

  for (const u of users) {
    const apiKey = `sk-emp-${Math.random().toString(36).slice(2, 18)}`;
    // users 表 14 列: id, feishu_id, name, avatar, email, department, department_id, employee_id, api_key, role, status, monthly_quota, created_at, updated_at
    dbAny.exec(
      `INSERT INTO users (id, feishu_id, name, avatar, email, department, department_id, employee_id, api_key, role, status, monthly_quota, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [u[0], u[1], u[2], u[3], u[4], u[5], u[6], apiKey, u[7], u[8], regTs, regTs]
    );
  }
  // 管理员固定 API Key（方便 dev-login）
  dbAny.exec(`UPDATE users SET api_key = 'sk-emp-dev-test-key' WHERE id = 'u_admin'`);

  // ===== 插入渠道 =====
  dbAny.exec(`INSERT INTO channels VALUES ('ch_deepseek', 'DeepSeek 官方', 'https://api.deepseek.com', 'YOUR_DEEPSEEK_API_KEY', '["deepseek-chat","deepseek-reasoner"]', 0, 'active', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO channels VALUES ('ch_silicon', '硅基流动', 'https://api.siliconflow.cn', 'YOUR_SILICONFLOW_API_KEY', '["deepseek-ai/deepseek-chat-v3-0324"]', 1, 'active', ?)`, [regTs]);

  // ===== 生成 30 天 usage_logs =====
  let seed = 42;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

  const models = [
    { name: "deepseek-chat", inPrice: 0.001, outPrice: 0.002, w: 0.55 },
    { name: "deepseek-reasoner", inPrice: 0.004, outPrice: 0.016, w: 0.15 },
    { name: "deepseek-ai/deepseek-chat-v3-0324", inPrice: 0.0008, outPrice: 0.0016, w: 0.2 },
    { name: "Pro/deepseek-ai/deepseek-r1", inPrice: 0.003, outPrice: 0.012, w: 0.1 },
  ];
  const channels = ["ch_deepseek", "ch_silicon"];
  const activity: Record<string, number> = { u_admin: 1.5, u_dev_wang: 2.0, u_dev_li: 1.0, u_mkt_chen: 1.2, u_mkt_zhao: 0.8, u_design_sun: 0.6, u_design_zhou: 0.5, u_ops_wu: 1.1 };
  const todayDate = new Date();
  const startDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - 29);

  let totalRecords = 0;
  for (let d = 0; d < 30; d++) {
    const day = new Date(startDate.getTime() + d * 86400000);
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const isToday = d === 29;
    const base = isWeekend ? randInt(5, 15) : randInt(30, 50);
    const boost = isToday ? 8 : 1;

    for (const u of users) {
      const act = activity[u[0]] || 0.5;
      const count = Math.round(base * act * (0.6 + rand() * 0.8) * boost);
      for (let r = 0; r < count; r++) {
        const hr = rand() < 0.6 ? randInt(9, 17) : rand() < 0.8 ? randInt(18, 22) : randInt(0, 8);
        const min = randInt(0, 59);
        const sec = randInt(0, 59);
        const ts = Math.floor(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hr, min, sec).getTime() / 1000);

        // 加权随机选模型
        const totalW = models.reduce((s, mm) => s + mm.w, 0);
        let rr = rand() * totalW;
        let mi = 0;
        for (let ii = 0; ii < models.length; ii++) { rr -= models[ii].w; if (rr <= 0) { mi = ii; break; } }
        const model = models[mi];
        const isDev = u[4] === "研发部";
        const inTok = isDev ? randInt(800, 6000) : randInt(300, 4000);
        const outTok = isDev ? randInt(500, 4000) : randInt(200, 2500);
        const cost = Number(((inTok * model.inPrice + outTok * model.outPrice) / 1000).toFixed(4));
        const ch = rand() < 0.7 ? "ch_deepseek" : "ch_silicon";

        dbAny.exec(`INSERT INTO usage_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`log_${totalRecords}`, u[0], model.name, inTok, outTok, inTok + outTok, cost, ch, ts]);
        totalRecords++;
      }
    }
  }

  // ===== 限额规则 =====
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_company', 'company', 'all', 20000, 'u_admin', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_dev', 'department', 'dept_dev', 8000, 'u_admin', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_mkt', 'department', 'dept_mkt', 5000, 'u_admin', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_design', 'department', 'dept_design', 3000, 'u_admin', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_ops', 'department', 'dept_ops', 4000, 'u_admin', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_wang', 'personal', 'u_dev_wang', 400, 'u_admin', ?)`, [regTs]);

  // ===== 预警记录 =====
  const alerts = [
    ["personal_80", "u_dev_wang", "王工本月用量已达限额的 80%"],
    ["dept_80", "dept_dev", "研发部本月用量已达限额的 80%"],
    ["anomaly", "u_mkt_zhao", "赵策划出现异常用量：1小时内消耗 ¥15.2"],
  ];
  for (let i = 0; i < alerts.length; i++) {
    dbAny.exec(`INSERT INTO alert_logs VALUES (?, ?, ?, ?, ?)`, [`alert_${i}`, ...alerts[i], now - (15 - i * 4) * 86400]);
  }

  // ===== 操作日志 =====
  const logs = [
    ["update_quota", "user", "u_dev_wang", '{"from":200,"to":400}'],
    ["create_channel", "channel", "ch_silicon", '{"name":"硅基流动"}'],
    ["export_report", "report", "monthly_202605", '{"month":"2026-05"}'],
  ];
  for (let i = 0; i < logs.length; i++) {
    dbAny.exec(`INSERT INTO admin_logs VALUES (?, 'u_admin', ?, ?, ?, ?, ?)`, [`alog_${i}`, ...logs[i], now - (20 - i * 5) * 86400]);
  }

  await saveDb();

  return NextResponse.json({
    success: true,
    message: "模拟数据已填充",
    stats: {
      users: users.length,
      usageLogs: totalRecords,
      channels: 2,
      quotaRules: 6,
      alerts: alerts.length,
      adminLogs: logs.length,
    },
  });
}
