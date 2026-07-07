"use strict";
// 自动更新封装（electron-updater）。
// 设计要点：
// - electron-updater 未安装时降级为 no-op，绝不阻塞主进程启动（开发态/精简包也能跑）
// - macOS 未签名：Squirrel.Mac 校验签名失败，update-downloaded 永不触发 → mac 直接 short-circuit，
//   不误导用户"后台下载中"
// - 更新源由 electron-builder 的 publish 配置决定（打包时写入 app-update.yml）
// - 接收 window getter（实时取最新窗口，避免持有已销毁旧引用，mac 关窗再开也能弹）
// - 用户感知：发现新版→提示后台下载；下载完→提示重启；已承诺下载却失败→提示（否则用户干等）

let autoUpdater = null;
try {
  // eslint-disable-next-line global-require
  autoUpdater = require("electron-updater").autoUpdater;
} catch (_) {
  autoUpdater = null;
}

const { dialog } = require("electron");

function initAutoUpdater(getWindow) {
  if (!autoUpdater) {
    console.log("[updater] electron-updater 未安装，跳过自动更新");
    return;
  }
  // macOS 未签名：Squirrel.Mac 无法校验签名，update-downloaded 永不触发，直接跳过
  // （mac 新版需手动下载 dmg 覆盖；Windows 不受影响）
  if (process.platform === "darwin") {
    console.log("[updater] mac 未签名，跳过自动更新");
    return;
  }
  // 兼容旧调用（直接传 BrowserWindow）：包成 getter
  const getWin = typeof getWindow === "function" ? getWindow : () => getWindow;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m) => console.log("[updater]", m),
    warn: (m) => console.warn("[updater]", m),
    error: (m) => console.error("[updater]", m),
  };

  // 国内 GitHub 直连慢/失败，自动更新走镜像（多镜像 fallback：gh-proxy.com → ghproxy.net → gh-proxy.net → GitHub 直连兜底）。
  // 任一镜像失败，error 事件自动切下一个重试，提高国内下载成功率。
  const RELEASE_URL = "https://github.com/kristen1015man-ai/ai-token-manager/releases/latest/download/";
  const MIRROR_BASES = [
    "https://gh-proxy.com/" + RELEASE_URL,
    "https://ghproxy.net/" + RELEASE_URL,
    "https://gh-proxy.net/" + RELEASE_URL,
    RELEASE_URL, // GitHub 直连兜底（有代理的用户能走）
  ];
  let mirrorIdx = 0;
  let mirrorRetry = 0;
  const setMirrorFeed = () => {
    try {
      autoUpdater.setFeedURL({ provider: "generic", url: MIRROR_BASES[mirrorIdx] });
      console.log("[updater] 更新源:", MIRROR_BASES[mirrorIdx]);
    } catch (e) {
      console.warn("[updater] setFeedURL 失败:", e && e.message);
    }
  };
  setMirrorFeed();

  let hasAnnouncedUpdate = false; // 是否已向用户承诺"后台下载中"

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] 发现新版本", info && info.version);
    hasAnnouncedUpdate = true;
    const w = getWin();
    if (w && !w.isDestroyed()) {
      dialog
        .showMessageBox(w, {
          type: "info",
          title: "发现新版本",
          message: `Sparkloom Studio ${info && info.version} 已发布，正在后台下载，完成后会提示你重启。`,
          buttons: ["好的"],
        })
        .catch(() => {});
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    const w = getWin();
    const target = w && !w.isDestroyed() ? w : null;
    dialog
      .showMessageBox(target, {
        type: "info",
        title: "更新已就绪",
        message: `新版本 ${info && info.version} 已下载，重启后生效。`,
        buttons: ["立即重启", "稍后"],
      })
      .then((res) => {
        if (res && res.response === 0) autoUpdater.quitAndInstall();
      })
      .catch(() => {});
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] error", err && err.message, "镜像:", MIRROR_BASES[mirrorIdx]);
    // 切下一个镜像重试（避免单镜像不稳/被墙）。最多切 MIRROR_BASES.length 次，防循环。
    if (mirrorRetry < MIRROR_BASES.length - 1) {
      mirrorRetry++;
      mirrorIdx = (mirrorIdx + 1) % MIRROR_BASES.length;
      console.log("[updater] 切镜像重试:", MIRROR_BASES[mirrorIdx]);
      setMirrorFeed();
      setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 1500).unref();
      return;
    }
    // 全部镜像失败 → 提示用户手动下载
    if (hasAnnouncedUpdate) {
      hasAnnouncedUpdate = false;
      mirrorRetry = 0; // 重置，下次启动/4 小时后再试
      const w = getWin();
      if (w && !w.isDestroyed()) {
        dialog
          .showMessageBox(w, {
            type: "warning",
            title: "更新下载失败",
            message: "所有镜像下载失败（国内 GitHub 不稳）。请手动下载：访问 ai.seapllo.com/download 点「镜像下载」按钮，下载最新版覆盖安装。",
            buttons: ["好的"],
          })
          .catch(() => {});
      }
    }
  });

  // 延迟首次检查（避免和 Agent 启动抢资源）+ 周期性检查（每 4 小时，覆盖长时间挂机）
  const checkOnce = () => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.log("[updater] 检查失败（开发态或无更新源，正常）:", e && e.message);
    });
  };
  // L15: 首次检查的 setTimeout 也补 .unref()，与下一行 setInterval 保持一致，
  // 避免启动后 5 秒内退出应用时该 timer 拖住主进程事件循环。
  setTimeout(checkOnce, 5000).unref();
  setInterval(checkOnce, 4 * 60 * 60 * 1000).unref();
}

module.exports = { initAutoUpdater };
