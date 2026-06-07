/**
 * generate-usage.ts — 30 天用量日志生成（确定性 PRNG）
 */
import type { SqliteExec } from "../../../../lib/db";

// 模型列表：名称、输入/输出价格（每千 token）、使用权重、所属渠道
const MODELS = [
  { name: "deepseek-chat", inPrice: 0.001, outPrice: 0.002, w: 0.30, channel: "ch_deepseek" },
  { name: "deepseek-reasoner", inPrice: 0.004, outPrice: 0.016, w: 0.08, channel: "ch_deepseek" },
  { name: "deepseek-v4-flash", inPrice: 0.001, outPrice: 0.002, w: 0.20, channel: "ch_deepseek" },
  { name: "deepseek-v4-pro", inPrice: 0.003, outPrice: 0.006, w: 0.08, channel: "ch_deepseek" },
  { name: "deepseek-ai/deepseek-chat-v3-0324", inPrice: 0.0008, outPrice: 0.0016, w: 0.10, channel: "ch_silicon" },
  { name: "glm-5.1", inPrice: 0.006, outPrice: 0.024, w: 0.10, channel: "ch_glm" },
  { name: "glm-4-flash", inPrice: 0.0001, outPrice: 0.0001, w: 0.08, channel: "ch_glm" },
  { name: "gpt-5.5", inPrice: 0.036, outPrice: 0.216, w: 0.04, channel: "ch_openai" },
  { name: "gpt-4o", inPrice: 0.0175, outPrice: 0.060, w: 0.02, channel: "ch_openai" },
];

const TOTAL_WEIGHT = MODELS.reduce((s, m) => s + m.w, 0);

interface SeedUser {
  id: string;
  dept: string;
  role: string;
  act: number;
}

/**
 * 生成 30 天用量日志（确定性 PRNG，seed=42）
 * 返回写入的记录总数
 */
export function generateUsageLogs(
  db: SqliteExec,
  userRows: SeedUser[],
  startDate: Date,
): number {
  let seed = 42;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

  let totalRecords = 0;

  for (let d = 0; d < 30; d++) {
    const day = new Date(startDate.getTime() + d * 86400000);
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const isToday = d === 29;
    const base = isWeekend ? randInt(2, 6) : randInt(8, 20);
    const boost = isToday ? 4 : 1;

    for (const u of userRows) {
      const count = Math.round(base * u.act * (0.6 + rand() * 0.8) * boost);
      for (let r = 0; r < count; r++) {
        const hr = rand() < 0.6 ? randInt(9, 17) : rand() < 0.8 ? randInt(18, 22) : randInt(0, 8);
        const min = randInt(0, 59);
        const sec = randInt(0, 59);
        const ts = Math.floor(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hr, min, sec).getTime() / 1000);

        // 按权重选模型
        let rr = rand() * TOTAL_WEIGHT;
        let mi = 0;
        for (let ii = 0; ii < MODELS.length; ii++) { rr -= MODELS[ii].w; if (rr <= 0) { mi = ii; break; } }
        const model = MODELS[mi];

        const isTech = u.dept === "IT部" || u.dept === "产品部";
        const inTok = isTech ? randInt(800, 6000) : randInt(300, 4000);
        const outTok = isTech ? randInt(500, 4000) : randInt(200, 2500);
        const cost = Number(((inTok * model.inPrice + outTok * model.outPrice) / 1000).toFixed(4));

        db.exec(`INSERT INTO usage_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`log_${totalRecords}`, u.id, model.name, inTok, outTok, inTok + outTok, cost, model.channel, ts]);
        totalRecords++;
      }
    }
  }

  return totalRecords;
}
