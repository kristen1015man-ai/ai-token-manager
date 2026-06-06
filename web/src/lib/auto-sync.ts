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
 * 渠道余额同步：
 * - 04:00 凌晨（价格同步之后 1 小时，避免并发）
 *
 * 服务器启动 30 秒后也会执行一次初始同步。
 */

const FEISHU_SYNC_HOURS = [12, 19]; // 每天中午12点、晚上7点
const FEISHU_SYNC_URL = "http://localhost:3000/api/setup/sync-feishu";
const PRICE_SYNC_URL = "http://localhost:3000/api/admin/prices/sync";
const BALANCE_SYNC_URL = "http://localhost:3000/api/admin/channels/balance-sync";

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
  console.log(`[AutoSync] 余额同步：每天 04:00`);

  // 服务器启动 30 秒后执行一次初始同步
  setTimeout(() => {
    triggerFeishuSync("启动同步");
    triggerPriceSync("启动同步");
    // 余额同步延迟到 60 秒后，等价格同步先跑
    setTimeout(() => triggerBalanceSync("启动同步"), 30_000);
  }, 30_000);

  // 计算到下一个同步时间点的延迟
  scheduleFeishuNext();
  schedulePriceNext();
  scheduleBalanceNext();
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

function scheduleBalanceNext() {
  const delay = calcNextDelay([4]);
  console.log(`[AutoSync] 余额下次同步将在 ${Math.round(delay / 60000)} 分钟后执行`);

  setTimeout(() => {
    triggerBalanceSync("定时同步");
    scheduleBalanceNext();
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
      const rateInfo = data.exchangeRate ? `，汇率 1 USD = ${data.exchangeRate.rate.toFixed(4)} CNY（${data.exchangeRate.source}）` : "";
      console.log(`[AutoSync] ===== 价格${reason} 完成: 更新 ${data.updated} 条，新增 ${data.added} 条${rateInfo} =====`);
    } else {
      console.error(`[AutoSync] 价格${reason} 返回错误:`, data.error);
    }
  } catch (error) {
    console.error(`[AutoSync] 价格${reason} 请求失败:`, error);
  }
}

async function triggerBalanceSync(reason: string) {
  try {
    console.log(`[AutoSync] ===== 余额${reason} 开始 =====`);
    const resp = await fetch(BALANCE_SYNC_URL, { method: "POST" });
    const data = await resp.json() as { synced: number; failed: number; alerts: Array<{ channelName: string; severity: string }> };
    console.log(`[AutoSync] ===== 余额${reason} 完成: 同步 ${data.synced} 个，失败 ${data.failed} 个 =====`);

    if (data.alerts && data.alerts.length > 0) {
      const dangerCount = data.alerts.filter(a => a.severity === "danger").length;
      const warnCount = data.alerts.filter(a => a.severity === "warning").length;
      console.warn(`[AutoSync] ⚠️ 余额预警: ${dangerCount} 个严重不足, ${warnCount} 个偏低`);
      data.alerts.forEach(a => {
        console.warn(`[AutoSync]   - ${a.channelName}: ${a.severity === "danger" ? "🔴" : "🟡"} ${a.severity}`);
      });
      // 飞书告警由 balance-sync API 内部异步发送
    }
  } catch (error) {
    console.error(`[AutoSync] 余额${reason} 请求失败:`, error);
  }
}
