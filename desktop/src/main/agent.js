"use strict";
// Agent 子进程管理：用 Electron 二进制（ELECTRON_RUN_AS_NODE）当 Node 跑 Agent，
// 轮询 health 就绪，退出时杀整个进程树（含 SDK spawn 的 claude.exe）。
// 子进程提前死亡时立即抛错（带最近 stderr），避免空等 30s。

const { spawn, execFileSync } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");

const AGENT_PORT = Number(process.env.SPARKLOOM_AGENT_PORT || 39271);
const HEALTH_URL = `http://127.0.0.1:${AGENT_PORT}/health`;

function healthCheck(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const j = JSON.parse(body);
          if (j && j.service === "sparkloom-agent" && Number(j.protocolVersion) === 1) {
            return resolve(j);
          }
        } catch (_) {}
        resolve(null);
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(null);
    });
  });
}

// 构建子进程 env：白名单保留系统必需 + SPARKLOOM_*/CLAUDE_*，剔除敏感凭证
// （避免 6 个全局 hook 脚本能读到 AWS_*/GITHUB_TOKEN/ANTHROPIC_API_KEY 等并外发）。
function buildAgentEnv() {
  const SENSITIVE = /(_SECRET|_PASSWORD|_API_KEY|_TOKEN$|_KEY$|_CREDENTIAL|^AWS_|^GITHUB_TOKEN|^GH_TOKEN|^ANTHROPIC_|^npm_config_(authToken|_auth)|^NODE_(PATH|OPTIONS)$)/i;
  const ALLOW_PREFIX = ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC", "LANG", "LC_", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "USERDOMAIN", "USERNAME", "COMPUTERNAME"];
  const ALLOW_EXACT = new Set(["PATHEXT", "NUMBER_OF_PROCESSORS", "OS", "PROCESSOR_ARCHITECTURE", "WINDIR"]);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (SENSITIVE.test(k)) continue;
    if (ALLOW_EXACT.has(k) || ALLOW_PREFIX.some((p) => k.startsWith(p)) || k.startsWith("SPARKLOOM_") || k.startsWith("CLAUDE_")) {
      env[k] = v;
    }
  }
  env.ELECTRON_RUN_AS_NODE = "1"; // 让 Electron 二进制以纯 Node 模式跑入口脚本
  env.SPARKLOOM_AGENT_PORT = String(AGENT_PORT);
  env.SPARKLOOM_CONFIG_HOME = process.env.SPARKLOOM_CONFIG_HOME || path.join(os.homedir(), ".sparkloom");
  return env;
}

function startAgent({ entryPath, agentRoot, onLog }) {
  const env = buildAgentEnv();

  const detached = process.platform !== "win32";
  const child = spawn(process.execPath, [entryPath], {
    env,
    cwd: agentRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached,
  });

  // 收集最近输出，子进程崩溃时附在错误信息里（打包态无控制台，靠这个诊断）
  const recentLines = [];
  const forward = (chunk) => {
    const text = chunk == null ? "" : chunk.toString();
    if (!text) return;
    recentLines.push(text);
    if (recentLines.length > 60) recentLines.shift();
    if (onLog) onLog(text);
    else process.stderr.write(`[agent] ${text}`);
  };
  child.stdout.on("data", forward);
  child.stderr.on("data", forward);
  child.on("error", (err) => forward(`spawn error: ${err.message}\n`));

  return { child, getRecentOutput: () => recentLines.slice(-60).join("") };
}

// 轮询 health；子进程提前退出则立即抛错（带最近输出）
async function waitForHealth(child, getRecentOutput, maxAttempts = 60, intervalMs = 500) {
  let exitInfo = null;
  child.once("exit", (code, signal) => {
    exitInfo = { code, signal };
  });

  for (let i = 0; i < maxAttempts; i += 1) {
    if (exitInfo) {
      const tail = getRecentOutput ? getRecentOutput().trim() : "";
      throw new Error(
        `Agent 进程提前退出（code=${exitInfo.code} signal=${exitInfo.signal}）${tail ? "：\n" + tail : ""}`
      );
    }
    const h = await healthCheck();
    if (h) return h;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Agent 在 ${Math.round((maxAttempts * intervalMs) / 1000)}s 内未就绪`);
}

function stopAgent(child) {
  if (!child || child.exitCode !== null || child.signal !== null) return;
  const pid = child.pid;
  try {
    if (process.platform === "win32") {
      // /T 杀整个进程树（Agent → SDK → claude.exe）
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch (_) {
        child.kill("SIGTERM");
      }
      // 2s 后 SIGKILL 兜底（agent 忙时可能忽略 SIGTERM；配合 agent 进程看门狗双保险）
      setTimeout(() => {
        try { process.kill(-pid, "SIGKILL"); } catch (_) {}
      }, 2000).unref();
    }
  } catch (_) {
    try {
      child.kill("SIGKILL");
    } catch (__) {}
  }
}

module.exports = {
  healthCheck,
  waitForHealth,
  startAgent,
  stopAgent,
  AGENT_PORT,
  HEALTH_URL,
};
