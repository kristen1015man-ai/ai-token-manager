// 任务 3：任务完成桌面通知
//
// 触发条件（任一满足）：
//   - 任务完成时页面不在前台（document.hidden === true）
//   - 任务时长 > 阈值（默认 30 秒，长任务值得提醒）
//
// 行为：
//   - 浏览器 Notification API（首次使用需 requestPermission）
//   - 点击通知 → window.focus() + 切到该 session（回调由调用方传入）
//   - localStorage "sparkloom.notify" 控制开关，默认 "on"（"off" 关闭）
//
// 注意：仅在浏览器环境执行；SSR / 非安全上下文（Notification 未定义）静默降级。

const NOTIFY_STORAGE_KEY = "sparkloom.notify";
export const TASK_NOTIFY_DURATION_THRESHOLD_MS = 30_000;

export type NotifySettings = {
  enabled: boolean;
  supported: boolean;
  permission: NotificationPermission | "unsupported";
};

export function isNotifySupported(): boolean {
  return typeof window !== "undefined" && typeof window.Notification !== "undefined";
}

export function readNotifySettings(): NotifySettings {
  if (!isNotifySupported()) {
    return { enabled: false, supported: false, permission: "unsupported" };
  }
  let enabled = true;
  try {
    const raw = window.localStorage.getItem(NOTIFY_STORAGE_KEY);
    if (raw === "off") enabled = false;
  } catch {
    // 隐私模式：默认开
  }
  return {
    enabled,
    supported: true,
    permission: Notification.permission,
  };
}

export function setNotifyEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(NOTIFY_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // 静默
  }
}

export async function requestNotifyPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isNotifySupported()) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    // 某些旧版浏览器需要回调形式；此处直接返回当前权限
    return Notification.permission;
  }
}

type TaskCompleteInfo = {
  sessionId: string;
  sessionTitle?: string;
  startedAt: number;
  finishedAt: number;
  ok: boolean;
  /** 用于通知正文（截断到 100 字） */
  lastAssistantText?: string;
};

type NotifyClickHandler = (sessionId: string) => void;

let clickHandler: NotifyClickHandler | null = null;

/** 注册点击通知的回调（在 StudioClient 顶层注册一次，回调内执行切会话 + focus） */
export function registerNotifyClickHandler(handler: NotifyClickHandler | null): void {
  clickHandler = handler;
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "";
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m} 分 ${s} 秒`;
}

/**
 * 检查条件并触发通知。返回是否真的发了通知（方便调用方/调试）。
 */
export function maybeNotifyTaskComplete(info: TaskCompleteInfo): boolean {
  if (!isNotifySupported()) return false;
  const settings = readNotifySettings();
  if (!settings.enabled) return false;
  if (settings.permission !== "granted") return false;

  const durationMs = Math.max(0, info.finishedAt - info.startedAt);
  const wasHidden = typeof document !== "undefined" && document.hidden === true;
  const longEnough = durationMs > TASK_NOTIFY_DURATION_THRESHOLD_MS;

  // 不在前台 或 时长超阈值 才提醒（前台 + 短任务不打扰）
  if (!wasHidden && !longEnough) return false;

  const title = info.ok ? "Sparkloom Studio 任务完成" : "Sparkloom Studio 任务失败";
  const preview = truncate(info.lastAssistantText || "", 100);
  const durationLabel = formatDuration(durationMs);
  const lines: string[] = [];
  if (preview) lines.push(preview);
  if (durationLabel) lines.push(`耗时 ${durationLabel}`);
  if (info.sessionTitle) lines.push(`会话：${info.sessionTitle}`);
  const body = lines.join("\n");

  try {
    const n = new Notification(title, {
      body,
      tag: `sparkloom-task-${info.sessionId}`,
      silent: false,
    });
    n.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      try { n.close(); } catch { /* ignore */ }
      if (clickHandler) clickHandler(info.sessionId);
    };
    // L11: 仅在前台短任务场景手动 close（实际上方 line 111 已提前 return false 拦截该场景，
    // 此分支等价于 no-op）；后台 / 长任务场景让通知留在 OS 通知中心，用户回来还能看到，
    // 不再无条件 5 秒强制 close（n.close() 会把条目从 Windows 操作中心 / macOS 通知中心一并移除）。
    if (!wasHidden && !longEnough) {
      window.setTimeout(() => {
        try { n.close(); } catch { /* ignore */ }
      }, 5000);
    }
    return true;
  } catch {
    return false;
  }
}
