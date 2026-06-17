/**
 * 发送本月员工 AI 用量排行榜到飞书群组
 */
const lark = require("./web/node_modules/@larksuiteoapi/node-sdk");
const initSqlJs = require("./web/node_modules/sql.js");
const fs = require("fs");

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const GROUP_CHAT_ID = process.env.LEADERBOARD_CHAT_ID;

if (!APP_ID || !APP_SECRET || !GROUP_CHAT_ID) {
  throw new Error("FEISHU_APP_ID, FEISHU_APP_SECRET and LEADERBOARD_CHAT_ID are required");
}

async function main() {
  // 1. 读数据库
  const buf = fs.readFileSync("./data.db");
  const SQL = await initSqlJs();
  const db = new SQL.Database(buf);

  const now = new Date();
  const monthStr = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartTs = Math.floor(monthStart.getTime() / 1000);

  const result = db.exec(`
    SELECT u.name, u.department,
           COALESCE(SUM(ul.cost), 0) as total_cost,
           COUNT(ul.id) as call_count,
           COALESCE(SUM(ul.total_tokens), 0) as total_tokens
    FROM users u
    LEFT JOIN usage_logs ul ON u.id = ul.user_id AND ul.created_at >= ${monthStartTs}
    WHERE u.status = 'active'
    GROUP BY u.id
    HAVING total_cost > 0
    ORDER BY total_cost DESC
  `);

  db.close();

  if (!result.length || !result[0].values.length) {
    console.log("没有用量数据，跳过发送");
    return;
  }

  const rows = result[0].values;
  const totalCost = rows.reduce((s, r) => s + r[2], 0);
  const totalCalls = rows.reduce((s, r) => s + r[3], 0);
  const activeUsers = rows.length;

  // 2. 构造排行榜
  const medals = ["🥇", "🥈", "🥉"];
  const top10 = rows.slice(0, 10);

  const rankLines = top10.map((r, i) => {
    const medal = i < 3 ? medals[i] : `**${i + 1}**`;
    const name = r[0];
    const dept = r[1] || "未知";
    const cost = r[2].toFixed(2);
    const calls = r[3];
    return `${medal}  ${name}（${dept}）— ¥${cost} / ${calls}次调用`;
  });

  // 3. 部门汇总
  const deptMap = {};
  for (const r of rows) {
    const dept = r[1] || "未知";
    if (!deptMap[dept]) deptMap[dept] = { cost: 0, calls: 0, users: 0 };
    deptMap[dept].cost += r[2];
    deptMap[dept].calls += r[3];
    deptMap[dept].users++;
  }
  const deptRanking = Object.entries(deptMap)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5);

  const deptLines = deptRanking.map(([dept, d]) => {
    return `📊 ${dept} — ¥${d.cost.toFixed(2)}（${d.users}人）`;
  });

  // 4. 发送卡片
  const client = new lark.Client({
    appId: APP_ID,
    appSecret: APP_SECRET,
  });

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `🏆 ${monthStr} 员工 AI 用量排行榜` },
      template: "indigo",
    },
    elements: [
      // 汇总信息
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `📅 **统计周期**：${monthStr}1日 ~ 至今\n💰 **总花费**：¥${totalCost.toFixed(2)}　📞 **总调用**：${totalCalls.toLocaleString()}次　👥 **活跃用户**：${activeUsers}人`,
        },
      },
      { tag: "hr" },
      // 排行榜标题
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: "**🏅 个人排行 TOP 10**",
        },
      },
      // 排行榜内容
      ...rankLines.map((line) => ({
        tag: "div",
        text: { tag: "lark_md", content: line },
      })),
      { tag: "hr" },
      // 部门排行
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: "**🏢 部门排行 TOP 5**",
        },
      },
      ...deptLines.map((line) => ({
        tag: "div",
        text: { tag: "lark_md", content: line },
      })),
      { tag: "hr" },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `💡 数据由 **玄牝词元管理系统** 自动统计生成`,
        },
      },
    ],
  };

  const resp = await client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: GROUP_CHAT_ID,
      msg_type: "interactive",
      content: JSON.stringify(card),
    },
  });

  console.log("✅ 排行榜已发送到群组！");
  console.log(`   活跃用户: ${activeUsers} 人`);
  console.log(`   总花费: ¥${totalCost.toFixed(2)}`);
  console.log(`   总调用: ${totalCalls} 次`);
}

main().catch((err) => {
  console.error("❌ 发送失败:", err);
  process.exit(1);
});
