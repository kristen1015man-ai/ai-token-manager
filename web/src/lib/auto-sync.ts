/**
 * 定时同步调度器
 *
 * 飞书员工数据：
 * - 12:00 中午（覆盖上午入职）
 * - 19:00 晚上（覆盖下午离职）
 *
 * 模型价格同步：
 * - 03:00 凌晨（每天一次）
 *
 * 服务器启动 30 秒后也会执行一次初始同步。
 */

const FEISHU_SYNC_HOURS = [12, 19]; // 每天中午12点、晚上7点
const FEISHU_SYNC_URL = "http://localhost:3000/api/setup/sync-feishu";
const PRICE_SYNC_URL = "http://localhost:3000/api/admin/prices/sync";

let started = false;

/**
 * 启动定时同步（只执行一次）
 */
export function startAutoSync() {
  if (started) return;
  started = true;

  console.log(`[AutoSync] 定时同步已启动`);
  console.log(`[AutoSync] 飞书同步：每天 ${FEISHU_SYNC_HOURS.map(h => `${String(h).padStart(2, "0")}:00`).join("、")}`);
  console.log(`[AutoSync] 价格同步：每天 03:00`);

  // 服务器启动 30 秒后执行一次初始同步
  setTimeout(() => {
    triggerFeishuSync("启动同步");
    triggerPriceSync("启动同步");
  }, 30_000);

  // 计算到下一个同步时间点的延迟
  scheduleFeishuNext();
  schedulePriceNext();
}

function scheduleFeishuNext() {
  const delay = calcNextDelay(FEISHU_SYNC_HOURS);
  console.log(`[AutoSync] 飞书下次同步将在 ${Math.round(delay / 60000)} 分钟后执行`);

  setTimeout(() => {
    triggerFeishuSync("定时同步");
    scheduleFeishuNext();
  }, delay);
}

function schedulePriceNext() {
  const delay = calcNextDelay([3]);
  console.log(`[AutoSync] 价格下次同步将在 ${Math.round(delay / 60000)} 分钟后执行`);

  setTimeout(() => {
    triggerPriceSync("定时同步");
    schedulePriceNext();
  }, delay);
}

function calcNextDelay(hours: number[]): number {
  const now = new Date();
  let nextHour = hours.find(h => h > now.getHours());
  let delay: number;

  if (nextHour !== undefined) {
    const next = new Date(now);
    next.setHours(nextHour, 0, 0, 0);
    delay = next.getTime() - now.getTime();
  } else {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(hours[0], 0, 0, 0);
    delay = next.getTime() - now.getTime();
  }

  return delay;
}

async function triggerFeishuSync(reason: string) {
  try {
    console.log(`[AutoSync] ===== 飞书${reason} 开始 =====`);
    const resp = await fetch(FEISHU_SYNC_URL, { method: "POST" });
    const data = await resp.json();
    if (data.success) {
      console.log(`[AutoSync] ===== 飞书${reason} 完成 =====`);
      console.log(`[AutoSync] ${JSON.stringify(data.stats)}`);
    } else {
      console.error(`[AutoSync] 飞书${reason} 返回错误:`, data.error || data.message);
    }
  } catch (error) {
    console.error(`[AutoSync] 飞书${reason} 请求失败:`, error);
  }
}

async function triggerPriceSync(reason: string) {
  try {
    console.log(`[AutoSync] ===== 价格${reason} 开始 =====`);
    const resp = await fetch(PRICE_SYNC_URL, { method: "POST" });
    const data = await resp.json();
    if (data.success) {
      console.log(`[AutoSync] ===== 价格${reason} 完成: 更新 ${data.updated} 条，新增 ${data.added} 条 =====`);
    } else {
      console.error(`[AutoSync] 价格${reason} 返回错误:`, data.error);
    }
  } catch (error) {
    console.error(`[AutoSync] 价格${reason} 请求失败:`, error);
  }
}
