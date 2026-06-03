import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb, resetDb } from "../../../../lib/db";
import * as fs from "fs";
import * as path from "path";

/**
 * 用真实飞书通讯录数据重新填充模拟数据
 * GET /api/setup/seed?force=1 → 删除旧库 + 重建 + 填充
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production" && !request.nextUrl.searchParams.get("force")) {
    return NextResponse.json({ error: "Add ?force=1 to seed in production" }, { status: 403 });
  }

  // ===== 强制删除旧数据库文件，彻底清除旧 schema =====
  resetDb(); // 先清除内存缓存
  const dbPath = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes(":")
    ? process.env.DATABASE_URL
    : process.env.RAILWAY_VOLUME_MOUNT_PATH
      ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/data.db`
      : "./data.db";
  const absPath = path.resolve(dbPath);
  try {
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
      console.log(`[Seed] 已删除旧数据库: ${absPath}`);
    }
  } catch (e: any) {
    console.log(`[Seed] 删除数据库失败: ${e.message}`);
  }

  const { sqlite } = await getDb(); // 会从空文件创建新实例
  const dbAny = sqlite as any;

  // ===== 建表（全新数据库） =====
  dbAny.exec(`CREATE TABLE users (
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
  dbAny.exec(`CREATE TABLE channels (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
    api_key TEXT NOT NULL, models TEXT NOT NULL DEFAULT '[]',
    priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
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
  dbAny.exec(`CREATE TABLE admin_logs (
    id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL,
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  dbAny.exec(`CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)`);
  dbAny.exec(`CREATE INDEX IF NOT EXISTS idx_users_feishu_id ON users(feishu_id)`);
  dbAny.exec(`CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id)`);
  dbAny.exec(`CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at)`);

  // ===== 管理员 ID（与 ADMIN_IDS 环境变量一致） =====
  const ADMIN_IDS = [
    "ou_f2e284bb6701647e664c938806b08627", // 何广明
    "ou_0d5004133227007a479e05d54d5c4b50", // 陈四华
  ];

  // ===== 真实飞书通讯录数据 =====
  const now = Math.floor(Date.now() / 1000);
  const regTs = now - 90 * 86400;

  // 格式: [id, feishu_id, name, email, department, department_id, employee_no, role, monthly_quota]
  const users = [
    // === 经管部 ===
    ["u_leijia", "ou_69c6464bcbd2fec0b33bd256ba4a12fd", "雷佳", "", "经管部", "c18g952aga5e4dg7", "", "member", 400],
    ["u_lengjinping", "ou_60fe25e8da2f2926c4e690b47eeb30e5", "冷金平", "", "经管部", "c18g952aga5e4dg7", "", "member", 350],
    ["u_wangyuxiang", "ou_14927a9e97b91943ca28195ca1a443d9", "王宇翔", "", "经管部", "c18g952aga5e4dg7", "", "member", 300],
    ["u_ouyangkexun", "ou_efb1bf6de13b4096cd435f4fe12afff9", "欧阳克训", "", "经管部", "c18g952aga5e4dg7", "", "member", 250],
    ["u_zhongdongsheng", "ou_cab74bb294430fb197ffbc80dc9e9244", "钟冬生", "", "经管部", "c18g952aga5e4dg7", "", "member", 200],
    ["u_zengqianwen", "ou_32fd271c8c892a8aa865a1814c8fec99", "曾倩文", "", "经管部", "c18g952aga5e4dg7", "", "member", 200],
    // === 市场组 ===
    ["u_heguangming", "ou_f2e284bb6701647e664c938806b08627", "何广明", "", "市场组", "ee7cgc3ac5c6dd4b", "", "admin", 500],
    ["u_lihuiwen", "ou_6985f7e10a3938661986ace2d0d38cb0", "李慧文", "", "市场组", "ee7cgc3ac5c6dd4b", "", "member", 250],
    ["u_zhangyuquan", "ou_4fe4377b0f144d1e2217e50d83659894", "张郁泉", "", "市场组", "ee7cgc3ac5c6dd4b", "", "member", 200],
    // === 开发组 ===
    ["u_wanghongling", "ou_17ac12117a2a8c6c7532b32bbc603026", "王洪领", "", "开发组", "7a4585g412e78532", "", "member", 350],
    ["u_liuhong", "ou_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", "刘虹", "", "开发组", "7a4585g412e78532", "", "member", 300],
    ["u_wuwende", "ou_2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e", "吴文德", "", "开发组", "7a4585g412e78532", "", "member", 280],
    ["u_guojianwu", "ou_3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f", "郭建武", "", "开发组", "7a4585g412e78532", "", "member", 250],
    ["u_huangkuntao", "ou_4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a", "黄坤涛", "", "开发组", "7a4585g412e78532", "", "member", 220],
    ["u_xieliangzhang", "ou_5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", "谢良璋", "", "开发组", "7a4585g412e78532", "", "member", 200],
    ["u_chentao", "ou_6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c", "陈涛", "", "开发组", "7a4585g412e78532", "", "member", 200],
    ["u_wangshixin", "ou_7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d", "王世鑫", "", "开发组", "7a4585g412e78532", "", "member", 180],
    ["u_liuwei", "ou_8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e", "刘威", "", "开发组", "7a4585g412e78532", "", "member", 180],
    // === 运维组 ===
    ["u_chensihua", "ou_0d5004133227007a479e05d54d5c4b50", "陈四华", "", "运维组", "8ggcb3fccc2a5d7c", "", "admin", 400],
    // === 运营一部 ===
    ["u_songjia", "ou_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", "宋佳", "", "运营一部", "1fb4d81764f83g3f", "", "member", 280],
    ["u_lufengdan", "ou_b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7", "陆凤丹", "", "运营一部一组", "7da32662b8ab4726", "", "member", 250],
    ["u_zhangrui", "ou_c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8", "张锐", "", "运营一部一组", "7da32662b8ab4726", "", "member", 220],
    ["u_chenhuanjie", "ou_d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9", "陈焕杰", "", "运营一部一组", "7da32662b8ab4726", "", "member", 200],
    ["u_laijieni", "ou_e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", "赖洁妮", "", "运营一部二组", "15f7c52242b85dde", "", "member", 200],
    ["u_yeyingqi", "ou_f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1", "叶颖琪", "", "运营一部二组", "15f7c52242b85dde", "", "member", 180],
    // === 运营二部 ===
    ["u_yanghui", "ou_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c00", "杨慧", "", "运营二部", "8bb21d8da81ga564", "", "member", 260],
    ["u_xiejiamin", "ou_2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d00", "谢佳敏", "", "运营二部一组", "84db4f9a5f76749a", "", "member", 230],
    ["u_fangwei", "ou_3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e00", "房伟", "", "运营二部一组", "84db4f9a5f76749a", "", "member", 200],
    // === 设计部 ===
    ["u_shenjiamhao", "ou_4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f00", "沈家豪", "", "设计部", "3a16728g9bdga2d3", "", "member", 240],
    ["u_chenyangbo", "ou_5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a00", "陈阳波", "", "设计部", "3a16728g9bdga2d3", "", "member", 220],
    ["u_xumangui", "ou_6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b00", "徐曼桂", "", "设计部", "3a16728g9bdga2d3", "", "member", 200],
    // === 品牌营销部 ===
    ["u_huqian", "ou_7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c00", "胡茜", "", "品牌营销部", "ed7g1gg69g95dec3", "", "member", 260],
    ["u_zenghuiyue", "ou_8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d00", "曾惠月", "", "品牌营销部", "ed7g1gg69g95dec3", "", "member", 220],
    // === 品质部 ===
    ["u_zengxueli", "ou_9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e00", "曾雪丽", "", "品质部", "2f2fccdf2d622a55", "", "member", 200],
    ["u_lengxiangyu", "ou_0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f00", "冷翔宇", "", "品质部", "2f2fccdf2d622a55", "", "member", 180],
    // === 财务部 ===
    ["u_yinlujie", "ou_1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a00", "尹璐洁", "", "财务部", "225acgd9c855fc1f", "", "member", 200],
    ["u_zuoxiaomei", "ou_2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b00", "左小美", "", "财务部", "225acgd9c855fc1f", "", "member", 180],
    // === 人力行政部 ===
    ["u_zhangying", "ou_3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c00", "张颖", "", "人力行政部", "1g9dgd5ca2797gb4", "", "member", 200],
    // === 仓储物流部 ===
    ["u_zhoulijun", "ou_4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d00", "周立军", "", "计划物流中心", "8fce881cab9ge395", "", "member", 200],
    ["u_hulu", "ou_5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e00", "胡露", "", "物流组", "ad581974g6ff8d14", "", "member", 180],
    // === 产品一组 ===
    ["u_zhezhuosheng", "ou_6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f00", "郑卓晟", "", "产品一组", "dbgc37bg62bccg17", "", "member", 250],
    ["u_yanjiahao", "ou_7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a00", "晏佳豪", "", "产品一组", "dbgc37bg62bccg17", "", "member", 230],
    // === 采购跟单部 ===
    ["u_mengchaolv", "ou_8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b00", "蒙朝侣", "", "采购跟单部", "3392g1de5g7f294a", "", "member", 180],
  ];

  // 插入用户
  for (const u of users) {
    const emailStr = typeof u[3] === "string" ? u[3] : "";
    const emailPrefix = emailStr ? emailStr.split("@")[0] : String(u[2]).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
    const apiKey = `sk-emp-${emailPrefix}-${Math.random().toString(36).slice(2, 8)}`;
    dbAny.exec(
      `INSERT INTO users (id, feishu_id, name, avatar, email, department, department_id, group_name, group_id, center_name, center_id, employee_id, api_key, role, status, monthly_quota, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [u[0], u[1], u[2], u[3], u[4], u[5], null, null, null, null, u[6], apiKey, u[7], u[8], regTs, regTs]
    );
  }
  // 何广明固定 API Key（方便 dev-login）
  dbAny.exec(`UPDATE users SET api_key = 'sk-emp-heguangming-dev-key' WHERE id = 'u_heguangming'`);

  // ===== 插入渠道 =====
  dbAny.exec(`INSERT INTO channels VALUES ('ch_deepseek', 'DeepSeek 官方', 'https://api.deepseek.com', 'YOUR_DEEPSEEK_API_KEY', '["deepseek-chat","deepseek-reasoner"]', 0, 'active', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO channels VALUES ('ch_silicon', '硅基流动', 'https://api.siliconflow.cn', 'YOUR_SILICONFLOW_API_KEY', '["deepseek-ai/deepseek-chat-v3-0324"]', 1, 'active', ?)`, [regTs]);

  // ===== 生成 30 天 usage_logs（基于真实用户） =====
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

  // 不同部门活跃度不同
  const deptActivity: Record<string, number> = {
    "开发组": 2.0, "运维组": 1.5, "经管部": 1.0,
    "市场组": 1.3, "运营一部一组": 1.8, "运营一部二组": 1.2,
    "运营二部一组": 1.5, "设计部": 1.0, "品牌营销部": 1.1,
    "产品一组": 1.6, "品质部": 0.6, "财务部": 0.5,
  };
  const userActivity: Record<string, number> = {};
  for (const u of users) {
    userActivity[u[0]] = deptActivity[u[4]] || 0.8;
    // 管理员活跃度高
    if (u[7] === "admin") userActivity[u[0]] = Math.max(userActivity[u[0]], 1.5);
  }

  const todayDate = new Date();
  const startDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - 29);

  let totalRecords = 0;
  for (let d = 0; d < 30; d++) {
    const day = new Date(startDate.getTime() + d * 86400000);
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const isToday = d === 29;
    const base = isWeekend ? randInt(3, 10) : randInt(20, 40);
    const boost = isToday ? 6 : 1;

    for (const u of users) {
      const act = userActivity[u[0]] || 0.5;
      const count = Math.round(base * act * (0.6 + rand() * 0.8) * boost);
      for (let r = 0; r < count; r++) {
        const hr = rand() < 0.6 ? randInt(9, 17) : rand() < 0.8 ? randInt(18, 22) : randInt(0, 8);
        const min = randInt(0, 59);
        const sec = randInt(0, 59);
        const ts = Math.floor(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hr, min, sec).getTime() / 1000);

        const totalW = models.reduce((s, mm) => s + mm.w, 0);
        let rr = rand() * totalW;
        let mi = 0;
        for (let ii = 0; ii < models.length; ii++) { rr -= models[ii].w; if (rr <= 0) { mi = ii; break; } }
        const model = models[mi];
        const isTech = u[4] === "开发组" || u[4] === "运维组" || u[4] === "产品一组";
        const inTok = isTech ? randInt(800, 6000) : randInt(300, 4000);
        const outTok = isTech ? randInt(500, 4000) : randInt(200, 2500);
        const cost = Number(((inTok * model.inPrice + outTok * model.outPrice) / 1000).toFixed(4));
        const ch = rand() < 0.7 ? "ch_deepseek" : "ch_silicon";

        dbAny.exec(`INSERT INTO usage_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`log_${totalRecords}`, u[0], model.name, inTok, outTok, inTok + outTok, cost, ch, ts]);
        totalRecords++;
      }
    }
  }

  // ===== 限额规则（基于真实部门结构） =====
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_company', 'company', 'all', 30000, 'u_heguangming', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_jingguan', 'department', 'c18g952aga5e4dg7', 5000, 'u_heguangming', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_shichang', 'department', 'ee7cgc3ac5c6dd4b', 3000, 'u_heguangming', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_kaifa', 'department', '7a4585g412e78532', 6000, 'u_heguangming', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_yunwei', 'department', '8ggcb3fccc2a5d7c', 3000, 'u_heguangming', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_yunying1', 'department', '1fb4d81764f83g3f', 5000, 'u_heguangming', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_yunying2', 'department', '8bb21d8da81ga564', 4000, 'u_heguangming', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_sheji', 'department', '3a16728g9bdga2d3', 3000, 'u_heguangming', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_pinpai', 'department', 'ed7g1gg69g95dec3', 3000, 'u_heguangming', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_changping', 'department', '2f2fccdf2d622a55', 2000, 'u_heguangming', ?)`, [regTs]);
  dbAny.exec(`INSERT INTO quota_rules VALUES ('q_caiwu', 'department', '225acgd9c855fc1f', 1500, 'u_heguangming', ?)`, [regTs]);

  // ===== 预警记录 =====
  const alerts = [
    ["personal_80", "u_wanghongling", "王洪领本月用量已达限额的 80%"],
    ["dept_80", "7a4585g412e78532", "开发组本月用量已达限额的 80%"],
    ["anomaly", "u_chenhuanjie", "陈焕杰出现异常用量：1小时内消耗 ¥18.5"],
  ];
  for (let i = 0; i < alerts.length; i++) {
    dbAny.exec(`INSERT INTO alert_logs VALUES (?, ?, ?, ?, ?)`, [`alert_${i}`, ...alerts[i], now - (15 - i * 4) * 86400]);
  }

  // ===== 操作日志 =====
  const logs = [
    ["sync_feishu", "system", "all", '{"departments":45,"users":153}'],
    ["update_quota", "department", "7a4585g412e78532", '{"from":5000,"to":6000}'],
    ["create_channel", "channel", "ch_silicon", '{"name":"硅基流动"}'],
    ["export_report", "report", "monthly_202605", '{"month":"2026-05"}'],
  ];
  for (let i = 0; i < logs.length; i++) {
    dbAny.exec(`INSERT INTO admin_logs VALUES (?, 'u_heguangming', ?, ?, ?, ?, ?)`, [`alog_${i}`, ...logs[i], now - (20 - i * 5) * 86400]);
  }

  await saveDb();
  resetDb(); // 清除内存缓存，下次请求从磁盘加载新 schema

  // 验证：重新加载后检查表结构
  const { sqlite: verifyDb } = await getDb();
  const verifyAny = verifyDb as any;
  const cols = verifyAny.exec(`PRAGMA table_info(users)`);
  const colNames = (cols[0]?.values ?? []).map((r: unknown[]) => String(r[1]));
  console.log(`[Seed] 验证 users 表列: ${colNames.join(", ")}`);

  return NextResponse.json({
    success: true,
    message: "真实通讯录模拟数据已填充",
    stats: {
      users: users.length,
      admins: users.filter(u => u[7] === "admin").map(u => u[2]).join(", "),
      usageLogs: totalRecords,
      channels: 2,
      quotaRules: 11,
      alerts: alerts.length,
      adminLogs: logs.length,
    },
    debug: { columns: colNames },
  });
}
