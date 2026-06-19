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
 * - 每小时同步一次，不发送提醒
 * - 余额不足提醒默认北京时间 09:30、12:00、14:30、17:30
 * - 可通过 BALANCE_SYNC_INTERVAL_MINUTES 和 BALANCE_ALERT_TIMES 调整
 *
 * 员工状态检查（离职自动停用）：
 * - 20:00 晚上（在 19:00 飞书同步之后，确保通讯录最新）
 *
 * 异常用量检测：
 * - 每小时整点（检测 1 小时内突增）
 *
 * 服务器启动后会延迟执行一次初始同步，避免刚部署完抢占后台页面首屏资源。
 */

type DailyTime = { hour: number; minute: number };

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const FEISHU_SYNC_HOURS = [12, 19]; // 北京时间每天中午12点、晚上7点
const DEFAULT_STARTUP_SYNC_DELAY_MS = 120_000;
const DEFAULT_BALANCE_SYNC_INTERVAL_MINUTES = 60;
const DEFAULT_BALANCE_ALERT_TIMES: DailyTime[] = [
  { hour: 9, minute: 30 },
  { hour: 12, minute: 0 },
  { hour: 14, minute: 30 },
  { hour: 17, minute: 30 },
];

function readNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readDailyTimesEnv(name: string, fallback: DailyTime[]): DailyTime[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const times = raw
    .split(",")
    .map((part) => part.trim())
    .map((part) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(part);
      if (!match) return null;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
      }
      return { hour, minute };
    })
    .filter((time): time is DailyTime => Boolean(time));
  const unique = new Map(times.map((time) => [`${time.hour}:${time.minute}`, time]));
  return Array.from(unique.values()).sort(compareDailyTime).length > 0
    ? Array.from(unique.values()).sort(compareDailyTime)
    : fallback;
}

function compareDailyTime(a: DailyTime, b: DailyTime): number {
  return a.hour === b.hour ? a.minute - b.minute : a.hour - b.hour;
}

function formatDailyTime(time: DailyTime): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

// 运行时端口：Railway 等平台会覆盖 PORT 环境变量（如 8080），
// 必须动态读取，否则所有定时任务都会 ECONNREFUSED
const SYNC_BASE = `http://localhost:${process.env.PORT || 3000}`;
const FEISHU_SYNC_URL = `${SYNC_BASE}/api/internal/admin/sync-feishu`;
const PRICE_SYNC_URL = `${SYNC_BASE}/api/internal/admin/prices/sync`;
const BALANCE_SYNC_URL = `${SYNC_BASE}/api/internal/admin/channels/balance-sync`;
const ANOMALY_CHECK_URL = `${SYNC_BASE}/api/internal/admin/anomaly-check`;
const EMPLOYEE_STATUS_CHECK_URL = `${SYNC_BASE}/api/internal/admin/employee-status-check`;
const LEADERBOARD_SEND_URL = `${SYNC_BASE}/api/internal/admin/leaderboard-send`;
const STARTUP_SYNC_ENABLED = process.env.AUTO_SYNC_ON_STARTUP !== "false";
const STARTUP_SYNC_DELAY_MS = readNonNegativeIntEnv("AUTO_SYNC_STARTUP_DELAY_MS", DEFAULT_STARTUP_SYNC_DELAY_MS);
const BALANCE_SYNC_INTERVAL_MINUTES = readPositiveIntEnv("BALANCE_SYNC_INTERVAL_MINUTES", DEFAULT_BALANCE_SYNC_INTERVAL_MINUTES);
const BALANCE_ALERT_TIMES = readDailyTimesEnv("BALANCE_ALERT_TIMES", DEFAULT_BALANCE_ALERT_TIMES);

let started = false;

/**
 * 启动定时同步（只执行一次）
 */
export function startAutoSync() {
  if (process.env.AUTO_SYNC_ENABLED === "false") {
    console.log("[AutoSync] 定时同步已禁用 (AUTO_SYNC_ENABLED=false)");
    return;
  }
  if (started) return;
  started = true;

  console.log(`[AutoSync] 定时同步已启动 (base=${SYNC_BASE})`);
  console.log(`[AutoSync] 所有每日时间均按北京时间（UTC+8）计算`);
  console.log(`[AutoSync] 飞书同步：每天 ${FEISHU_SYNC_HOURS.map(h => `${String(h).padStart(2, "0")}:00`).join("、")}`);
  console.log(`[AutoSync] 价格同步：每天 03:00`);
  console.log(`[AutoSync] 余额同步：每 ${BALANCE_SYNC_INTERVAL_MINUTES} 分钟一次，不发送提醒`);
  console.log(`[AutoSync] 余额提醒：每天 ${BALANCE_ALERT_TIMES.map(formatDailyTime).join("、")}`);
  console.log(`[AutoSync] 员工状态检查：每天 20:00`);
  console.log(`[AutoSync] 异常检测：每小时`);
  console.log(`[AutoSync] 排行榜：每天 10:00 检查是否发送`);

  if (STARTUP_SYNC_ENABLED) {
    console.log(`[AutoSync] 启动同步将在 ${Math.round(STARTUP_SYNC_DELAY_MS / 1000)} 秒后执行`);
    setTimeout(() => {
      triggerFeishuSync("启动同步");
      triggerPriceSync("启动同步");
      // 余额同步延后，等价格同步先跑
      setTimeout(() => triggerBalanceSync("启动同步", { notify: false }), 60_000);
    }, STARTUP_SYNC_DELAY_MS);

    // 启动检测再延后，避免与页面首屏和初始同步挤在一起
    setTimeout(() => triggerAnomalyCheck("启动检测"), STARTUP_SYNC_DELAY_MS + 120_000);
    setTimeout(() => triggerEmployeeStatusCheck("启动检测"), STARTUP_SYNC_DELAY_MS + 180_000);
  } else {
    console.log("[AutoSync] 启动同步已禁用 (AUTO_SYNC_ON_STARTUP=false)");
  }

  // 计算到下一个同步时间点的延迟
  scheduleFeishuNext();
  schedulePriceNext();
  scheduleBalanceNext();
  scheduleBalanceAlertNext();
  scheduleAnomalyNext();
  scheduleEmployeeStatusNext();
  scheduleLeaderboardNext();
}

function scheduleFeishuNext() {
  const delay = calcNextBeijingDelay(FEISHU_SYNC_HOURS.map(hour => ({ hour, minute: 0 })));
  console.log(`[AutoSync] 飞书下次同步将在 ${Math.round(delay / 60000)} 分钟后执行`);

  setTimeout(() => {
    triggerFeishuSync("定时同步");
    scheduleFeishuNext();
  }, delay);
}

function schedulePriceNext() {
  const delay = calcNextBeijingDelay([{ hour: 3, minute: 0 }]);
  console.log(`[AutoSync] 价格下次同步将在 ${Math.round(delay / 60000)} 分钟后执行`);

  setTimeout(() => {
    triggerPriceSync("定时同步");
    schedulePriceNext();
  }, delay);
}

function scheduleBalanceNext() {
  const delay = calcNextBeijingIntervalDelay(BALANCE_SYNC_INTERVAL_MINUTES);
  console.log(`[AutoSync] 余额下次同步将在 ${Math.round(delay / 60000)} 分钟后执行（不提醒）`);

  setTimeout(() => {
    triggerBalanceSync("定时同步", { notify: false });
    scheduleBalanceNext();
  }, delay);
}

function scheduleBalanceAlertNext() {
  const delay = calcNextBeijingDelay(BALANCE_ALERT_TIMES);
  console.log(`[AutoSync] 余额提醒下次执行将在 ${Math.round(delay / 60000)} 分钟后执行`);

  setTimeout(() => {
    triggerBalanceSync("余额提醒", { notify: true });
    scheduleBalanceAlertNext();
  }, delay);
}

function getBeijingDate(nowMs = Date.now()): Date {
  return new Date(nowMs + BEIJING_OFFSET_MS);
}

function calcNextBeijingDelay(times: DailyTime[]): number {
  const sortedTimes = [...times].sort(compareDailyTime);
  const nowMs = Date.now();
  const beijingNow = getBeijingDate(nowMs);
  const year = beijingNow.getUTCFullYear();
  const month = beijingNow.getUTCMonth();
  const date = beijingNow.getUTCDate();

  for (const dayOffset of [0, 1]) {
    for (const time of sortedTimes) {
      const beijingWallMs = Date.UTC(year, month, date + dayOffset, time.hour, time.minute, 0, 0);
      const utcCandidateMs = beijingWallMs - BEIJING_OFFSET_MS;
      if (utcCandidateMs > nowMs + 1000) {
        return utcCandidateMs - nowMs;
      }
    }
  }

  const first = sortedTimes[0];
  const fallbackWallMs = Date.UTC(year, month, date + 1, first.hour, first.minute, 0, 0);
  return fallbackWallMs - BEIJING_OFFSET_MS - nowMs;
}

function calcNextBeijingIntervalDelay(intervalMinutes: number): number {
  const nowMs = Date.now();
  const beijingNow = getBeijingDate(nowMs);
  const currentMinutes = beijingNow.getUTCHours() * 60 + beijingNow.getUTCMinutes();
  const nextSlotMinutes = Math.floor(currentMinutes / intervalMinutes) * intervalMinutes + intervalMinutes;
  const dayOffset = nextSlotMinutes >= 24 * 60 ? 1 : 0;
  const minuteOfDay = nextSlotMinutes % (24 * 60);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const beijingWallMs = Date.UTC(
    beijingNow.getUTCFullYear(),
    beijingNow.getUTCMonth(),
    beijingNow.getUTCDate() + dayOffset,
    hour,
    minute,
    0,
    0
  );
  return beijingWallMs - BEIJING_OFFSET_MS - nowMs;
}

async function triggerFeishuSync(reason: string) {
  try {
    console.log(`[AutoSync] ===== 飞书${reason} 开始 =====`);
    const internalKey = process.env.INTERNAL_API_KEY;
    const headers: Record<string, string> = {};
    if (internalKey) {
      headers["Authorization"] = `Bearer ${internalKey}`;
    }
    const resp = await fetch(FEISHU_SYNC_URL, { method: "POST", headers });
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
    const internalKey = process.env.INTERNAL_API_KEY;
    const headers: Record<string, string> = {};
    if (internalKey) {
      headers["Authorization"] = `Bearer ${internalKey}`;
    }
    const resp = await fetch(PRICE_SYNC_URL, { method: "POST", headers });
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

async function triggerBalanceSync(reason: string, options: { notify: boolean }) {
  try {
    console.log(`[AutoSync] ===== 余额${reason} 开始 =====`);
    const internalKey = process.env.INTERNAL_API_KEY;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (internalKey) {
      headers["Authorization"] = `Bearer ${internalKey}`;
    }
    const resp = await fetch(BALANCE_SYNC_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ notify: options.notify }),
    });
    const data = await resp.json() as { synced: number; failed: number; alerts: Array<{ channelName: string; severity: string }> };
    console.log(`[AutoSync] ===== 余额${reason} 完成: 同步 ${data.synced} 个，失败 ${data.failed} 个 =====`);

    if (data.alerts && data.alerts.length > 0) {
      const dangerCount = data.alerts.filter(a => a.severity === "danger").length;
      const warnCount = data.alerts.filter(a => a.severity === "warning").length;
      console.warn(`[AutoSync] ⚠️ 余额预警: ${dangerCount} 个严重不足, ${warnCount} 个偏低`);
      data.alerts.forEach(a => {
        console.warn(`[AutoSync]   - ${a.channelName}: ${a.severity === "danger" ? "🔴" : "🟡"} ${a.severity}`);
      });
      if (options.notify) {
        console.warn("[AutoSync] 余额提醒已交由 balance-sync API 异步发送");
      }
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
  return calcNextBeijingIntervalDelay(60);
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
    const internalKey = process.env.INTERNAL_API_KEY;
    const headers: Record<string, string> = {};
    if (internalKey) {
      headers["Authorization"] = `Bearer ${internalKey}`;
    }
    const resp = await fetch(ANOMALY_CHECK_URL, { method: "POST", headers });
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
  const delay = calcNextBeijingDelay([{ hour: 20, minute: 0 }]);
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

// ===== 排行榜定时发送调度（每天 10:00 检查） =====

/**
 * 排行榜调度：每天 10:00 检查今天是否应该发送排行榜
 * 实际发送条件由 leaderboard.ts 中的 shouldSendLeaderboardToday() 判断
 * （根据 schedule 和 sendDay 配置）
 */
function scheduleLeaderboardNext() {
  const delay = calcNextBeijingDelay([{ hour: 10, minute: 0 }]); // 每天北京时间 10:00 检查
  console.log(`[AutoSync] 排行榜检查将在 ${Math.round(delay / 60000)} 分钟后执行`);

  setTimeout(async () => {
    await triggerLeaderboardSend("定时检查");
    scheduleLeaderboardNext();
  }, delay);
}

async function triggerLeaderboardSend(reason: string) {
  try {
    console.log(`[AutoSync] ===== 排行榜${reason} 开始 =====`);

    // 先通过 leaderboard 模块判断今天是否需要发送
    const { shouldSendLeaderboardToday } = await import("./leaderboard");
    const shouldSend = await shouldSendLeaderboardToday();

    if (!shouldSend) {
      console.log(`[AutoSync] 排行榜${reason}: 今天不需要发送（频率/日期不匹配或已禁用）`);
      return;
    }

    const internalKey = process.env.INTERNAL_API_KEY;
    const headers: Record<string, string> = {};
    if (internalKey) {
      headers["Authorization"] = `Bearer ${internalKey}`;
    }

    const resp = await fetch(LEADERBOARD_SEND_URL, { method: "POST", headers });
    const data = await resp.json() as { success: boolean; sent: number; failed: number; chatIds: string[] };

    if (data.success) {
      console.log(`[AutoSync] ===== 排行榜${reason} 完成: 发送 ${data.sent} 个群组，失败 ${data.failed} 个 =====`);
    } else {
      console.error(`[AutoSync] 排行榜${reason} 返回错误:`, data);
    }
  } catch (error) {
    console.error(`[AutoSync] 排行榜${reason} 请求失败:`, error);
  }
}
