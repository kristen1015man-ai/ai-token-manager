"use strict";
// Sparkloom Studio 桌面端主进程。
// 职责：预置 Vibe Coding 框架 → 生成/读取本地 agent-token → 拉起内置 Agent
//      → 加载远程 Studio 页面 → 检查自动更新。

const { app, BrowserWindow, shell, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { ensureToken, configDir } = require("./token");
const { healthCheck, waitForHealth, startAgent, stopAgent } = require("./agent");
const { initAutoUpdater } = require("./updater");

const STUDIO_URL = process.env.SPARKLOOM_STUDIO_URL || "https://ai.seapllo.com/studio";

// 只允许加载/跳转的精确主机名（收窄，不接受任意 *.seapllo.com 子域，防子域被接管）
const ALLOWED_HOSTS = new Set(["ai.seapllo.com", "seapllo.com"]);

let mainWindow = null;
let agentChild = null;
let bootstrapped = false;

function isSameSite(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return ALLOWED_HOSTS.has(u.host);
  } catch (_) {
    return false;
  }
}

function resolveAgentEntry() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "agent", "desktop-entry.mjs");
  }
  return path.resolve(__dirname, "..", "..", "resources", "agent", "desktop-entry.mjs");
}

function resolveAgentRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "agent");
  }
  return path.resolve(__dirname, "..", "..", "resources", "agent");
}

// 判断 bash.exe 是否真是 Git Bash（排除 WSL 的 System32\bash.exe）。
// Git Bash 的 bin/bash.exe 同目录通常有 git.exe，或路径含 \Git\。
function isGitBash(bashPath) {
  const p = bashPath.replace(/\//g, "\\").toLowerCase();
  if (p.includes("\\windows\\") || p.includes("\\system32\\")) return false; // WSL 入口
  const dir = path.dirname(bashPath);
  try {
    if (fs.existsSync(path.join(dir, "git.exe"))) return true;
  } catch (_) {}
  return p.includes("\\git\\");
}

// 检测系统是否已装 Git Bash（PATH 扫描排除系统目录 + 常见路径含 Scoop/Choco/便携）。
// Claude Code 在 Windows 跑 hooks/Bash 工具需要它；没装则提示用户安装（Claude Code 官方系统要求）。
function detectSystemBash() {
  if (process.platform !== "win32") return null;
  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    try {
      const b = path.join(dir, "bash.exe");
      if (fs.existsSync(b) && isGitBash(b)) return b;
    } catch (_) {}
  }
  const candidates = [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "bin", "bash.exe"),
    path.join(process.env.CHOCOLATEYINSTALL || "", "bin", "bash.exe"),
    path.join(process.env.USERPROFILE || "", "scoop", "apps", "git", "current", "bin", "bash.exe"),
    path.join(process.env.USERPROFILE || "", "scoop", "shims", "bash.exe"),
  ];
  for (const b of candidates) {
    if (b && fs.existsSync(b)) return b;
  }
  return null;
}

// 手动递归复制（避开 cpSync 在 Node 24 + Windows 中文路径的崩溃）
function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (entry.isSymbolicLink()) {
      try {
        const t = fs.readlinkSync(from);
        const r = path.resolve(path.dirname(from), t);
        if (fs.existsSync(r)) copyDirRecursive(r, to);
        else fs.copyFileSync(from, to);
      } catch (_) {}
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

// 把 settings.json 里 hooks 脚本路径从项目级 ($CLAUDE_PROJECT_DIR/.claude/hooks)
// 改写为全局 ($CLAUDE_CONFIG_DIR/hooks)。正则幂等：已改写过的不会再次匹配。
function patchSettingsHooks(target) {
  const f = path.join(target, "settings.json");
  if (!fs.existsSync(f)) return;
  try {
    let content = fs.readFileSync(f, "utf8");
    // 样板格式（JSON 文本，带转义引号）：\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/X.sh
    // 改写为：\"$CLAUDE_CONFIG_DIR\"/hooks/X.sh
    content = content.replace(
      /\$CLAUDE_PROJECT_DIR(\\?["']?)\/\.claude\/hooks/g,
      '$CLAUDE_CONFIG_DIR$1/hooks'
    );
    fs.writeFileSync(f, content);
    console.log("[main] hooks 全局化完成 (CLAUDE_PROJECT_DIR/.claude/hooks -> CLAUDE_CONFIG_DIR/hooks)");
  } catch (err) {
    console.error("[main] patch settings hooks failed:", err && err.message);
  }
}

// 预置 Vibe Coding 框架到 claude.exe 全局配置目录 (~/.sparkloom/claude-code)。
// 仅在无 CLAUDE.md 时预置，绝不覆盖用户已有内容。
function ensureFramework() {
  const target = path.join(configDir(), "claude-code");
  try {
    // 先无条件 patch：老用户从项目级升级到全局化也能生效（正则幂等，未预置/已 patch 都安全）。
    // 必须在 CLAUDE.md 检测之前，否则老用户 return false 跳过 patch。
    patchSettingsHooks(target);
    if (fs.existsSync(path.join(target, "CLAUDE.md"))) return false;
    const src = app.isPackaged
      ? path.join(process.resourcesPath, "framework")
      : path.resolve(__dirname, "..", "..", "resources", "framework");
    if (!fs.existsSync(src)) return false;
    copyDirRecursive(src, target);
    patchSettingsHooks(target); // 新复制的模板再 patch 一次
    console.log("[main] framework seeded to", target);
    return true;
  } catch (err) {
    console.error("[main] framework seed failed:", err && err.message);
    return false;
  }
}

async function bootstrap() {
  ensureFramework();
  const token = ensureToken();
  let existing = await healthCheck();
  if (existing) {
    // 单实例锁保证这是唯一实例；existing 只可能是上次崩溃的孤儿 agent。
    // 看门狗（desktop-entry.mjs）3s 内检测到旧父死会 self-exit。等其退出，避免 spawn 新 agent 撞 EADDRINUSE。
    console.log("[main] 检测到残留 Agent（疑似上次崩溃孤儿），等待其看门狗退出…");
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!(await healthCheck())) break;
    }
    existing = await healthCheck();
  }
  if (!existing) {
    const { child, getRecentOutput } = startAgent({
      entryPath: resolveAgentEntry(),
      agentRoot: resolveAgentRoot(),
    });
    agentChild = child;
    await waitForHealth(child, getRecentOutput);
  }
  bootstrapped = true;
  return token;
}

// Git Bash 检测 + 缺失提示（非阻塞，不卡启动主链：主窗口先创建，弹窗 fire-and-forget）。
function maybePromptGitBash() {
  if (process.platform !== "win32" || detectSystemBash()) return;
  dialog
    .showMessageBox({
      type: "warning",
      title: "需要安装 Git for Windows",
      message:
        "Claude Code 需要 Git for Windows 才能运行（Bash 工具 + 自动化 hooks）。\n\n检测到本机未安装 Git。安装完成后请【重启 Sparkloom Studio】才能生效（已运行的 Agent 持有旧环境，不重启 hooks/Bash 仍不可用）。\n\n是否前往官方下载？",
      buttons: ["前往下载", "稍后"],
      cancelId: 1,
    })
    .then((choice) => {
      if (choice.response === 0) shell.openExternal("https://git-scm.com/download/win");
    })
    .catch(() => {});
}

function createWindow(token) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "Sparkloom Studio",
    backgroundColor: "#0a0d12",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // setWindowOpenHandler 在下面 app.on("web-contents-created") 全局挂（覆盖主窗口 + 任意 popup），
  // 这里不再单独挂 mainWindow 的，避免重复注册。

  mainWindow.once("ready-to-show", () => mainWindow.show());

  const url = `${STUDIO_URL}#sparkloomAgentToken=${encodeURIComponent(token)}`;
  mainWindow.loadURL(url).catch((err) => {
    dialog.showErrorBox("Sparkloom Studio", `无法加载 Studio 页面：\n${err && err.message ? err.message : err}`);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// 单实例锁：多实例并发会导致 agent 所有权错乱（A 退出杀掉 B 正用的 agent）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const token = await bootstrap();
      createWindow(token);
      initAutoUpdater(() => mainWindow);
      maybePromptGitBash(); // 非阻塞：不 await，主窗口已先创建
    } catch (err) {
      // bootstrap 失败：清理可能已 spawn 的 agent（避免占端口），再退出（避免无窗口僵尸）
      if (agentChild) {
        try { stopAgent(agentChild); } catch (_) {}
        agentChild = null;
      }
      dialog.showErrorBox(
        "Sparkloom Studio 启动失败",
        `Agent 启动失败：\n${err && err.message ? err.message : err}\n\n请截图反馈给管理员。`
      );
      app.quit();
    }
    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0 && bootstrapped) {
        createWindow(ensureToken());
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (agentChild) stopAgent(agentChild);
});

app.on("web-contents-created", (_event, contents) => {
  // 给每个 webContents（含主窗口 + 任意 popup）都挂 setWindowOpenHandler，
  // 防止同站 popup 用 Electron 默认行为打开外链/恶意窗口，绕过主窗口的 openExternal 路由。
  contents.setWindowOpenHandler(({ url }) => {
    if (isSameSite(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } };
    }
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", (e, url) => {
    if (!isSameSite(url)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
});
