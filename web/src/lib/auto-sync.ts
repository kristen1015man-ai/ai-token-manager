/**
 * 飞书员工数据定时同步调度器
 *
 * 每天两个时间点自动同步：
 * - 12:00 中午（覆盖上午入职）
 * - 19:00 晚上（覆盖下午离职）
 *
 * 服务器启动 30 秒后也会执行一次初始同步。
 *
 * 直接调用本地 POST /api/setup/sync-feishu 接口，
 * 复用已有的同步 + 规范化 + 清理逻辑，不重复代码。
 */

const SYNC_HOURS = [12, 19]; // 每天中午12点、晚上7点
const SYNC_URL = "http://localhost:3000/api/setup/sync-feishu";

let started = false;

/**
 * 启动定时同步（只执行一次）
 */
export function startAutoSync() {
  if (started) return;
  started = true;

  console.log(`[AutoSync] 定时同步已启动，同步时间：每天 ${SYNC_HOURS.map(h => `${String(h).padStart(2, "0")}:00`).join("、")}`);

  // 服务器启动 30 秒后执行一次初始同步
  setTimeout(() => {
    triggerSync("启动同步");
  }, 30_000);

  // 计算到下一个同步时间点的延迟
  scheduleNext();
}

function scheduleNext() {
  const now = new Date();
  let nextHour = SYNC_HOURS.find(h => h > now.getHours());
  let delay: number;

  if (nextHour !== undefined) {
    // 今天还有同步时间点
    const next = new Date(now);
    next.setHours(nextHour, 0, 0, 0);
    delay = next.getTime() - now.getTime();
  } else {
    // 今天的同步时间都过了，等明天第一个时间点
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(SYNC_HOURS[0], 0, 0, 0);
    delay = next.getTime() - now.getTime();
  }

  console.log(`[AutoSync] 下次同步将在 ${Math.round(delay / 60000)} 分钟后执行`);

  setTimeout(() => {
    triggerSync("定时同步");
    // 计算下下一个时间点
    scheduleNext();
  }, delay);
}

async function triggerSync(reason: string) {
  try {
    console.log(`[AutoSync] ===== ${reason} 开始 =====`);
    const resp = await fetch(SYNC_URL, { method: "POST" });
    const data = await resp.json();
    if (data.success) {
      console.log(`[AutoSync] ===== ${reason} 完成 =====`);
      console.log(`[AutoSync] ${JSON.stringify(data.stats)}`);
    } else {
      console.error(`[AutoSync] ${reason} 返回错误:`, data.error || data.message);
    }
  } catch (error) {
    console.error(`[AutoSync] ${reason} 请求失败:`, error);
  }
}
