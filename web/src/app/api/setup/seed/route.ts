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
  const dbAny = sqlite as any;

  // ===== 建表 =====
  dbAny.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, feishu_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    avatar TEXT, email TEXT, department TEXT, department_id TEXT,
    group_name TEXT, group_id TEXT, center_name TEXT, center_id TEXT,
    employee_id TEXT, api_key TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'member',
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

  // ===== 管理员 feishu_id =====
  const ADMIN_IDS = [
    "ou_f2e284bb6701647e664c938806b08627", // 何广明
    "ou_0d5004133227007a479e05d54d5c4b50", // 陈四华
  ];

  // ===== 部门定义 + 全员名单（153人，使用清理后的部门名） =====
  const DEPT_DATA: { dept: string; deptId: string; members: { name: string; fid: string; quota?: number }[] }[] = [
    // ── 运营部（40人，最大部门） ──
    { dept: "运营部", deptId: "dept_yunying", members: [
      { name: "宋佳", fid: "ou_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", quota: 280 },
      { name: "陆凤丹", fid: "ou_b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7", quota: 250 },
      { name: "张锐", fid: "ou_c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8", quota: 220 },
      { name: "陈焕杰", fid: "ou_d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9", quota: 200 },
      { name: "赖洁妮", fid: "ou_e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", quota: 200 },
      { name: "叶颖琪", fid: "ou_f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1", quota: 180 },
      { name: "杨慧", fid: "ou_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c00", quota: 260 },
      { name: "谢佳敏", fid: "ou_2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d00", quota: 230 },
      { name: "房伟", fid: "ou_3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e00", quota: 200 },
      { name: "刘婷", fid: "ou_yy01", quota: 200 },
      { name: "黄丽华", fid: "ou_yy02", quota: 180 },
      { name: "周明", fid: "ou_yy03", quota: 190 },
      { name: "吴丽萍", fid: "ou_yy04", quota: 170 },
      { name: "李健", fid: "ou_yy05", quota: 210 },
      { name: "赵小芳", fid: "ou_yy06", quota: 160 },
      { name: "陈丽娟", fid: "ou_yy07", quota: 180 },
      { name: "杨秀英", fid: "ou_yy08", quota: 170 },
      { name: "黄敏", fid: "ou_yy09", quota: 190 },
      { name: "周丽", fid: "ou_yy10", quota: 160 },
      { name: "吴静", fid: "ou_yy11", quota: 180 },
      { name: "徐丹", fid: "ou_yy12", quota: 170 },
      { name: "孙明华", fid: "ou_yy13", quota: 200 },
      { name: "胡小红", fid: "ou_yy14", quota: 160 },
      { name: "朱丽丽", fid: "ou_yy15", quota: 170 },
      { name: "高志强", fid: "ou_yy16", quota: 190 },
      { name: "林淑珍", fid: "ou_yy17", quota: 160 },
      { name: "何美玲", fid: "ou_yy18", quota: 180 },
      { name: "郭志伟", fid: "ou_yy19", quota: 200 },
      { name: "马秀兰", fid: "ou_yy20", quota: 150 },
      { name: "罗建", fid: "ou_yy21", quota: 180 },
      { name: "梁小红", fid: "ou_yy22", quota: 160 },
      { name: "宋丽华", fid: "ou_yy23", quota: 170 },
      { name: "郑小明", fid: "ou_yy24", quota: 190 },
      { name: "谢小红", fid: "ou_yy25", quota: 160 },
      { name: "韩志强", fid: "ou_yy26", quota: 180 },
      { name: "唐敏", fid: "ou_yy27", quota: 170 },
      { name: "冯丽萍", fid: "ou_yy28", quota: 160 },
      { name: "于建明", fid: "ou_yy29", quota: 190 },
      { name: "董小红", fid: "ou_yy30", quota: 170 },
      { name: "程志伟", fid: "ou_yy31", quota: 200 },
    ]},
    // ── 经管部（12人） ──
    { dept: "经管部", deptId: "dept_jingguan", members: [
      { name: "雷佳", fid: "ou_69c6464bcbd2fec0b33bd256ba4a12fd", quota: 400 },
      { name: "冷金平", fid: "ou_60fe25e8da2f2926c4e690b47eeb30e5", quota: 350 },
      { name: "王宇翔", fid: "ou_14927a9e97b91943ca28195ca1a443d9", quota: 300 },
      { name: "欧阳克训", fid: "ou_efb1bf6de13b4096cd435f4fe12afff9", quota: 250 },
      { name: "钟冬生", fid: "ou_cab74bb294430fb197ffbc80dc9e9244", quota: 200 },
      { name: "曾倩文", fid: "ou_32fd271c8c892a8aa865a1814c8fec99", quota: 200 },
      { name: "何广明", fid: "ou_f2e284bb6701647e664c938806b08627", quota: 500 },
      { name: "李慧文", fid: "ou_6985f7e10a3938661986ace2d0d38cb0", quota: 250 },
      { name: "张郁泉", fid: "ou_4fe4377b0f144d1e2217e50d83659894", quota: 200 },
      { name: "刘小明", fid: "ou_jg01", quota: 180 },
      { name: "陈志华", fid: "ou_jg02", quota: 200 },
      { name: "赵美玲", fid: "ou_jg03", quota: 170 },
    ]},
    // ── IT部（15人） ──
    { dept: "IT部", deptId: "dept_it", members: [
      { name: "王洪领", fid: "ou_17ac12117a2a8c6c7532b32bbc603026", quota: 350 },
      { name: "刘虹", fid: "ou_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", quota: 300 },
      { name: "吴文德", fid: "ou_2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e", quota: 280 },
      { name: "郭建武", fid: "ou_3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f", quota: 250 },
      { name: "黄坤涛", fid: "ou_4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a", quota: 220 },
      { name: "谢良璋", fid: "ou_5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", quota: 200 },
      { name: "陈涛", fid: "ou_6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c", quota: 200 },
      { name: "王世鑫", fid: "ou_7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d", quota: 180 },
      { name: "刘威", fid: "ou_8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e", quota: 180 },
      { name: "陈四华", fid: "ou_0d5004133227007a479e05d54d5c4b50", quota: 400 },
      { name: "周建华", fid: "ou_it01", quota: 250 },
      { name: "李志强", fid: "ou_it02", quota: 220 },
      { name: "张伟明", fid: "ou_it03", quota: 200 },
      { name: "黄小龙", fid: "ou_it04", quota: 180 },
      { name: "吴建平", fid: "ou_it05", quota: 190 },
    ]},
    // ── 产品部（18人） ──
    { dept: "产品部", deptId: "dept_product", members: [
      { name: "郑卓晟", fid: "ou_6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f00", quota: 250 },
      { name: "晏佳豪", fid: "ou_7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a00", quota: 230 },
      { name: "王建国", fid: "ou_cp01", quota: 240 },
      { name: "李志明", fid: "ou_cp02", quota: 220 },
      { name: "张小红", fid: "ou_cp03", quota: 200 },
      { name: "刘美玲", fid: "ou_cp04", quota: 190 },
      { name: "陈志伟", fid: "ou_cp05", quota: 210 },
      { name: "杨建华", fid: "ou_cp06", quota: 200 },
      { name: "赵丽华", fid: "ou_cp07", quota: 180 },
      { name: "黄小明", fid: "ou_cp08", quota: 190 },
      { name: "周志强", fid: "ou_cp09", quota: 220 },
      { name: "吴丽娟", fid: "ou_cp10", quota: 170 },
      { name: "徐建明", fid: "ou_cp11", quota: 200 },
      { name: "孙小红", fid: "ou_cp12", quota: 180 },
      { name: "胡志华", fid: "ou_cp13", quota: 190 },
      { name: "朱美英", fid: "ou_cp14", quota: 170 },
      { name: "高建军", fid: "ou_cp15", quota: 210 },
      { name: "林志明", fid: "ou_cp16", quota: 200 },
    ]},
    // ── 仓储物流部（12人） ──
    { dept: "仓储物流部", deptId: "dept_cangchu", members: [
      { name: "周立军", fid: "ou_4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d00", quota: 200 },
      { name: "胡露", fid: "ou_5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e00", quota: 180 },
      { name: "王大明", fid: "ou_cc01", quota: 180 },
      { name: "李秀英", fid: "ou_cc02", quota: 160 },
      { name: "张志华", fid: "ou_cc03", quota: 170 },
      { name: "刘建军", fid: "ou_cc04", quota: 190 },
      { name: "陈小红", fid: "ou_cc05", quota: 160 },
      { name: "杨志明", fid: "ou_cc06", quota: 180 },
      { name: "赵建平", fid: "ou_cc07", quota: 170 },
      { name: "黄丽华", fid: "ou_cc08", quota: 150 },
      { name: "周美玲", fid: "ou_cc09", quota: 160 },
      { name: "吴志强", fid: "ou_cc10", quota: 180 },
    ]},
    // ── 设计部（6人） ──
    { dept: "设计部", deptId: "dept_sheji", members: [
      { name: "沈家豪", fid: "ou_4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f00", quota: 240 },
      { name: "陈阳波", fid: "ou_5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a00", quota: 220 },
      { name: "徐曼桂", fid: "ou_6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b00", quota: 200 },
      { name: "刘小丽", fid: "ou_sj01", quota: 180 },
      { name: "黄志明", fid: "ou_sj02", quota: 190 },
      { name: "张美华", fid: "ou_sj03", quota: 170 },
    ]},
    // ── 品质部（8人） ──
    { dept: "品质部", deptId: "dept_pinzhi", members: [
      { name: "曾雪丽", fid: "ou_9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e00", quota: 200 },
      { name: "冷翔宇", fid: "ou_0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f00", quota: 180 },
      { name: "王建军", fid: "ou_pz01", quota: 190 },
      { name: "李秀兰", fid: "ou_pz02", quota: 170 },
      { name: "张志伟", fid: "ou_pz03", quota: 180 },
      { name: "刘美华", fid: "ou_pz04", quota: 160 },
      { name: "陈建华", fid: "ou_pz05", quota: 190 },
      { name: "杨小芳", fid: "ou_pz06", quota: 170 },
    ]},
    // ── 品牌营销部（7人） ──
    { dept: "品牌营销部", deptId: "dept_pinpai", members: [
      { name: "胡茜", fid: "ou_7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c00", quota: 260 },
      { name: "曾惠月", fid: "ou_8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d00", quota: 220 },
      { name: "赵志明", fid: "ou_pp01", quota: 200 },
      { name: "黄丽娟", fid: "ou_pp02", quota: 180 },
      { name: "周小华", fid: "ou_pp03", quota: 190 },
      { name: "吴美玲", fid: "ou_pp04", quota: 170 },
      { name: "刘建明", fid: "ou_pp05", quota: 200 },
    ]},
    // ── 财务部（6人） ──
    { dept: "财务部", deptId: "dept_caiwu", members: [
      { name: "尹璐洁", fid: "ou_1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a00", quota: 200 },
      { name: "左小美", fid: "ou_2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b00", quota: 180 },
      { name: "王秀英", fid: "ou_cw01", quota: 170 },
      { name: "李美华", fid: "ou_cw02", quota: 160 },
      { name: "张丽萍", fid: "ou_cw03", quota: 170 },
      { name: "陈小红", fid: "ou_cw04", quota: 160 },
    ]},
    // ── 人力行政部（5人） ──
    { dept: "人力行政部", deptId: "dept_hr", members: [
      { name: "张颖", fid: "ou_3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c00", quota: 200 },
      { name: "刘建华", fid: "ou_hr01", quota: 180 },
      { name: "陈美玲", fid: "ou_hr02", quota: 170 },
      { name: "杨志华", fid: "ou_hr03", quota: 160 },
      { name: "赵小丽", fid: "ou_hr04", quota: 170 },
    ]},
    // ── 采购跟单部（8人） ──
    { dept: "采购跟单部", deptId: "dept_caigougd", members: [
      { name: "蒙朝侣", fid: "ou_8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b00", quota: 180 },
      { name: "王志明", fid: "ou_cg01", quota: 190 },
      { name: "李小红", fid: "ou_cg02", quota: 170 },
      { name: "张建军", fid: "ou_cg03", quota: 180 },
      { name: "刘美华", fid: "ou_cg04", quota: 160 },
      { name: "陈建华", fid: "ou_cg05", quota: 180 },
      { name: "杨秀兰", fid: "ou_cg06", quota: 170 },
      { name: "黄小明", fid: "ou_cg07", quota: 190 },
    ]},
    // ── 采购寻源部（6人） ──
    { dept: "采购寻源部", deptId: "dept_caigouxy", members: [
      { name: "周志强", fid: "ou_xy01", quota: 200 },
      { name: "吴丽华", fid: "ou_xy02", quota: 180 },
      { name: "徐建明", fid: "ou_xy03", quota: 190 },
      { name: "孙小红", fid: "ou_xy04", quota: 170 },
      { name: "胡志伟", fid: "ou_xy05", quota: 180 },
      { name: "朱美玲", fid: "ou_xy06", quota: 160 },
    ]},
    // ── 计划部（5人） ──
    { dept: "计划部", deptId: "dept_jihua", members: [
      { name: "高志明", fid: "ou_jh01", quota: 200 },
      { name: "林秀华", fid: "ou_jh02", quota: 180 },
      { name: "何建军", fid: "ou_jh03", quota: 190 },
      { name: "郭小红", fid: "ou_jh04", quota: 170 },
      { name: "马美英", fid: "ou_jh05", quota: 160 },
    ]},
  ];

  const now = Math.floor(Date.now() / 1000);
  const regTs = now - 90 * 86400;
  let userIdx = 0;

  // 插入用户
  for (const dept of DEPT_DATA) {
    for (const m of dept.members) {
      const uid = `u_${String(userIdx++).padStart(3, "0")}`;
      const isAdmin = ADMIN_IDS.includes(m.fid);
      const emailPrefix = m.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || `user${userIdx}`;
      const apiKey = `sk-emp-${emailPrefix}-${uid.slice(2)}`;
      dbAny.exec(
        `INSERT INTO users (id, feishu_id, name, avatar, email, department, department_id, group_name, group_id, center_name, center_id, employee_id, api_key, role, status, monthly_quota, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, '', ?, ?, 'active', ?, ?, ?)`,
        [uid, m.fid, m.name, `${emailPrefix}@company.com`, dept.dept, dept.deptId, apiKey, isAdmin ? "admin" : "member", m.quota || 200, regTs, regTs]
      );
    }
  }

  // 何广明固定 API Key（方便 dev-login）
  dbAny.exec(`UPDATE users SET api_key = 'sk-emp-heguangming-dev-key' WHERE feishu_id = 'ou_f2e284bb6701647e664c938806b08627'`);

  // ===== 渠道 =====
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

  // 不同部门活跃度
  const deptActivity: Record<string, number> = {
    "IT部": 2.0, "产品部": 1.6, "运营部": 1.4, "经管部": 1.0,
    "设计部": 1.0, "品牌营销部": 1.1, "品质部": 0.6, "财务部": 0.5,
    "人力行政部": 0.4, "仓储物流部": 0.5, "采购跟单部": 0.6,
    "采购寻源部": 0.5, "计划部": 0.4,
  };

  // 读取刚插入的所有用户
  const allUsers = dbAny.exec(`SELECT id, department, role FROM users`);
  const userRows: { id: string; dept: string; role: string; act: number }[] = (allUsers[0]?.values ?? []).map((r: unknown[]) => {
    const dept = String(r[1]);
    const role = String(r[2]);
    let act = deptActivity[dept] || 0.5;
    if (role === "admin") act = Math.max(act, 1.5);
    return { id: String(r[0]), dept, role, act };
  });

  const todayDate = new Date();
  const startDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - 29);

  let totalRecords = 0;
  for (let d = 0; d < 30; d++) {
    const day = new Date(startDate.getTime() + d * 86400000);
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const isToday = d === 29;
    // 153人，每天每人的基础调用数适当降低，避免日志过多
    const base = isWeekend ? randInt(2, 6) : randInt(8, 20);
    const boost = isToday ? 4 : 1;

    for (const u of userRows) {
      const count = Math.round(base * u.act * (0.6 + rand() * 0.8) * boost);
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
        const isTech = u.dept === "IT部" || u.dept === "产品部";
        const inTok = isTech ? randInt(800, 6000) : randInt(300, 4000);
        const outTok = isTech ? randInt(500, 4000) : randInt(200, 2500);
        const cost = Number(((inTok * model.inPrice + outTok * model.outPrice) / 1000).toFixed(4));
        const ch = rand() < 0.7 ? "ch_deepseek" : "ch_silicon";

        dbAny.exec(`INSERT INTO usage_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`log_${totalRecords}`, u.id, model.name, inTok, outTok, inTok + outTok, cost, ch, ts]);
        totalRecords++;
      }
    }
  }

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
      channels: 2,
      quotaRules: DEPT_DATA.length + 1,
    },
  });
}
