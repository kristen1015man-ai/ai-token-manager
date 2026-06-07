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
 * 员工状态检查（离职自动停用）：
 * - 20:00 晚上（在 19:00 飞书同步之后，确保通讯录最新）
 *
 * 异常用量检测：
 * - 每小时整点（检测 1 小时内突增）
 *
 * 服务器启动 30 秒后也会执行一次初始同步。
 */

const FEISHU_SYNC_HOURS = [12, 19]; // 每天中午12点、晚上7点

// 运行时端口：Railway 等平台会覆盖 PORT 环境变量（如 8080），
// 必须动态读取，否则所有定时任务都会 ECONNREFUSED
const SYNC_BASE = `http://localhost:${process.env.PORT || 3000}`;
const FEISHU_SYNC_URL = `${SYNC_BASE}/api/setup/sync-feishu`;
const PRICE_SYNC_URL = `${SYNC_BASE}/api/admin/prices/sync`;
const BALANCE_SYNC_URL = `${SYNC_BASE}/api/admin/channels/balance-sync`;
const ANOMALY_CHECK_URL = `${SYNC_BASE}/api/admin/anomaly-check`;
const EMPLOYEE_STATUS_CHECK_URL = `${SYNC_BASE}/api/admin/employee-status-check`;

let started = false;

/**
 * 启动定时同步（只执行一次）
 */
export function startAutoSync() {
  if (started) return;
  started = true;

  console.log(`[AutoSync] 定时同步已启动 (base=${SYNC_BASE})`);
  console.log(`[AutoSync] 飞书同步：每天 ${FEISHU_SYNC_HOURS.map(h => `${String(h).padStart(2, "0")}:00`).join("、")}`);
  console.log(`[AutoSync] 价格同步：每天 03:00`);
  console.log(`[AutoSync] 余额同步：每天 04:00`);
  console.log(`[AutoSync] 员工状态检查：每天 20:00`);
  console.log(`[AutoSync] 异常检测：每小时`);

  // 服务器启动 30 秒后执行一次初始同步
  setTimeout(() => {
    triggerFeishuSync("启动同步");
    triggerPriceSync("启动同步");
    // 余额同步延迟到 60 秒后，等价格同步先跑
    setTimeout(() => triggerBalanceSync("启动同步"), 30_000);
  }, 30_000);

  // 启动 90 秒后执行一次异常检测（等其他初始同步先完成）
  setTimeout(() => triggerAnomalyCheck("启动检测"), 90_000);

  // 启动 120 秒后执行一次员工状态检查（等飞书同步先完成）
  setTimeout(() => triggerEmployeeStatusCheck("启动检测"), 120_000);

  // 计算到下一个同步时间点的延迟
  scheduleFeishuNext();
  schedulePriceNext();
  scheduleBalanceNext();
  scheduleAnomalyNext();
  scheduleEmployeeStatusNext();
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

// ===== 异常用量检测调度（每小时） =====

/**
 * 计算到下一个整点的延迟
 * 异常检测每小时运行一次
 */
function calcHourlyDelay(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0); // 下一个整点
  return next.getTime() - now.getTime();
}

function scheduleAnomalyNext() {
  const delay = calcHourlyDelay();
  console.log(`[AutoSync] 异常检测将在 ${Math.round(delay / 60000)} 分钟后执行`);

  setTimeout(() => {
    triggerAnomalyCheck("定时检测");
    scheduleAnomalyNext();
  }, delay);
}

async function triggerAnomalyCheck(reason: string) {
  try {
    console.log(`[AutoSync] ===== 异常检测${reason} 开始 =====`);
    const resp = await fetch(ANOMALY_CHECK_URL, { method: "POST" });
    const data = await resp.json() as { checked: number; anomalyCount: number; skipped: number; anomalies: Array<{ userName: string; hourlyCost: number }> };
    console.log(`[AutoSync] ===== 异常检测${reason} 完成: 检查 ${data.checked} 人, ${data.anomalyCount} 个异常 =====`);

    if (data.anomalies && data.anomalies.length > 0) {
      data.anomalies.forEach(a => {
        console.warn(`[AutoSync]   🚨 ${a.userName}: ¥${a.hourlyCost.toFixed(2)}/h`);
      });
    }
  } catch (error) {
    console.error(`[AutoSync] 异常检测${reason} 请求失败:`, error);
  }
}

// ===== 员工状态检查调度（每天 20:00） =====

function scheduleEmployeeStatusNext() {
  const delay = calcNextDelay([20]);
  console.log(`[AutoSync] 员工状态检查将在 ${Math.round(delay / 60000)} 分钟后执行`);

  setTimeout(() => {
    triggerEmployeeStatusCheck("定时检查");
    scheduleEmployeeStatusNext();
  }, delay);
}

async function triggerEmployeeStatusCheck(reason: string) {
  try {
    console.log(`[AutoSync] ===== 员工状态${reason} 开始 =====`);
    const internalKey = process.env.INTERNAL_API_KEY;
    const headers: Record<string, string> = {};
    if (internalKey) {
      headers["Authorization"] = `Bearer ${internalKey}`;
    }
    const resp = await fetch(EMPLOYEE_STATUS_CHECK_URL, { method: "POST", headers });
    const data = await resp.json() as { checked: number; disabled: number; users: Array<{ name: string; reason: string }> };
    console.log(`[AutoSync] ===== 员工状态${reason} 完成: 检查 ${data.checked} 人, 停用 ${data.disabled} 人 =====`);

    if (data.users && data.users.length > 0) {
      data.users.forEach(u => {
        console.warn(`[AutoSync]   🚫 ${u.name}: ${u.reason}`);
      });
    }
  } catch (error) {
    console.error(`[AutoSync] 员工状态${reason} 请求失败:`, error);
  }
}
