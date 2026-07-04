"use strict";
// 打包前准备：把项目根 agent/ 复制成 desktop/resources/agent/（含扁平 node_modules 和
// 平台 native binary），生成桌面端入口 desktop-entry.mjs（含父进程看门狗），复制 logo 作为图标。
// 用 npm（非 pnpm）装依赖，避免 pnpm 符号链接在 electron-builder 打包时出问题。

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..");
const agentSrc = path.join(repoRoot, "agent");
const target = path.join(desktopRoot, "resources", "agent");
const buildDir = path.join(desktopRoot, "build");

const log = (msg) => console.log(`[prepare-agent] ${msg}`);

// 当前构建机平台对应的 SDK 平台包名 + claude 二进制名（CI 保证 runner 架构 = 目标架构）
function platformBinary() {
  if (process.platform === "win32") return ["claude-agent-sdk-win32-x64", "claude.exe"];
  if (process.platform === "darwin") return [`claude-agent-sdk-darwin-${process.arch}`, "claude"];
  return [`claude-agent-sdk-${process.platform}-${process.arch}`, "claude"];
}

// 手动递归复制（不用 fs.cpSync —— 在 Node 24 + Windows 中文路径下 cpSync 会进程崩溃）。
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isSymbolicLink()) {
      // 兼容 pnpm 符号链接：判 real 是文件还是目录（避免对文件型 symlink readdirSync 抛 ENOTDIR）
      try {
        const linkTarget = fs.readlinkSync(from);
        const real = path.resolve(path.dirname(from), linkTarget);
        if (fs.existsSync(real)) {
          const st = fs.statSync(real);
          if (st.isDirectory()) copyDir(real, to);
          else fs.copyFileSync(real, to);
        } else {
          fs.copyFileSync(from, to);
        }
      } catch (e) {
        // 不静默吞：暴露失败路径，避免目标静默缺失导致 Agent 启动 MODULE_NOT_FOUND 难定位
        console.warn(`[prepare-agent] symlink 复制失败：${from} -> ${e && e.message}`);
      }
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

// 1. 清空目标
log(`clean ${path.relative(repoRoot, target)}`);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

// 2. 复制 agent src / skills（目录）
for (const item of ["src", "skills"]) {
  const from = path.join(agentSrc, item);
  if (fs.existsSync(from)) {
    log(`copy ${item}`);
    copyDir(from, path.join(target, item));
  }
}
// package.json / package-lock.json（文件，用 copyFileSync 而非 copyDir）
for (const item of ["package.json", "package-lock.json"]) {
  const from = path.join(agentSrc, item);
  if (fs.existsSync(from)) {
    log(`copy ${item}`);
    fs.copyFileSync(from, path.join(target, item));
  }
}

// 3. 生成桌面端入口（清 ELECTRON_RUN_AS_NODE 防泄漏 + 父进程看门狗治僵尸）
const entryContent = `// 由 desktop/scripts/prepare-agent.cjs 生成 —— 不要手改。
// 桌面端 Agent 入口：启动时先清掉 ELECTRON_RUN_AS_NODE，防止它泄漏给 Agent 内部
// spawn 的 claude.exe / shell 子进程（Claude Code 已知坑 anthropics/claude-code#34836）。
delete process.env.ELECTRON_RUN_AS_NODE;

// 父进程看门狗：父（Electron 主进程）崩溃/被强杀时 before-quit 不触发，
// 靠这个 self-exit 避免变僵尸 Agent 占着 39271 端口（Windows 无 Job Object 的兜底）。
//
// L14 已知限制：探测用 process.kill(__parentPid, 0)，仅校验 PID 存活、不校验进程身份。
// 极端场景下父进程崩溃后该 PID 被操作系统复用给新进程，探测仍返回成功，看门狗误判父进程存活，
// Agent 不 self-exit 成为孤儿。根治方案是 Windows Job Object（JOBOBJECT_LIMIT_KILL_ON_JOB_CLOSE）：
// 主进程把 agent 子进程绑到 Job Object，主进程无论正常退出还是崩溃，OS 内核自动杀掉整个 agent
// 进程树，彻底消除 PID 复用窗口。这需要 native addon（如 node-windows-job-object），
// 当前未引入，靠缩短看门狗间隔（3s → 1500ms）减小撞窗概率作为轻量补强。
const __parentPid = process.ppid;
setInterval(() => {
  try { process.kill(__parentPid, 0); } catch (_) {
    console.log("[desktop-entry] 父进程已退出，Agent self-exit 避免僵尸");
    process.exit(0);
  }
}, 1500).unref();

await import("./src/index.mjs").catch((err) => {
  console.error("[desktop-entry] Agent 启动失败：", err);
  process.exit(1);
});
`;
fs.writeFileSync(path.join(target, "desktop-entry.mjs"), entryContent, "utf8");
log("write desktop-entry.mjs（含父进程看门狗）");

// 4. 装依赖（扁平 node_modules）
const forceInstall = process.argv.includes("--force-install");
if (fs.existsSync(path.join(target, "node_modules")) && !forceInstall) {
  log("node_modules 已存在，跳过 npm install（--force-install 可强制重装）");
} else {
  log("npm install --omit=dev（含 @anthropic-ai/claude-agent-sdk 平台 native binary）");
  const result = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: target,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`npm install 失败（exit ${result.status}）`);
  }
}

// 4.5 清理 node_modules 里运行用不到的文档/测试/源码映射（保守，只删公认安全的；不删 scripts/ 以防运行时 require）
function pruneNodeModules(dir) {
  let saved = 0;
  const rm = (p) => {
    try {
      const s = fs.statSync(p, { recursive: true }).size;
      fs.rmSync(p, { recursive: true, force: true });
      saved += s || 0;
    } catch (_) {}
  };
  const pruneNames = /^(LICENSE|LICENCE|CHANGELOG|CHANGES|README|HISTORY|NOTICE|AUTHORS|PATENTS)/i;
  const pruneExts = /\.(md|markdown|map|flow|coffee|tsbuildinfo|eslintignore|npmignore)$/i;
  // 不删 scripts/（部分包运行时 require('./scripts/...')，删了会潜伏崩）
  const pruneDirs = /^(test|tests|__tests__|__mocks__|docs|doc|documentation|examples|example|coverage|\.github|\.idea|\.vscode|benchmarks)$/;
  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (pruneDirs.test(e.name)) {
          rm(p);
          continue;
        }
        walk(p);
      } else if (e.isFile()) {
        if (pruneExts.test(e.name) || pruneNames.test(e.name)) {
          rm(p);
        }
      }
    }
  }
  walk(dir);
  return saved;
}
const pruned = pruneNodeModules(path.join(target, "node_modules"));
log(`prune node_modules 文档/测试/map，释放 ${(pruned / 1024 / 1024).toFixed(1)}MB`);

// 5. 校验关键产物 + 当前平台 native binary（缺失直接抛错，绝不产残包）
const required = [
  path.join(target, "src", "index.mjs"),
  path.join(target, "desktop-entry.mjs"),
  path.join(target, "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.mjs"),
];
for (const f of required) {
  if (!fs.existsSync(f)) throw new Error(`缺失关键文件：${f}`);
}
const [platPkgName, binName] = platformBinary();
const platPkgDir = path.join(target, "node_modules", "@anthropic-ai", platPkgName);
if (!fs.existsSync(path.join(platPkgDir, binName))) {
  throw new Error(
    `缺失平台 binary ${platPkgName}/${binName}（构建机 ${process.platform}/${process.arch}）。` +
    `打包前 --force-install 重装，或确认 CI runner 架构与目标一致。`
  );
}
log(`平台 binary 校验通过：${platPkgName}/${binName}`);

// 6. 复制 logo 作为应用图标
fs.mkdirSync(buildDir, { recursive: true });
const logoSrc = path.join(repoRoot, "web", "public", "logo.png");
if (fs.existsSync(logoSrc)) {
  fs.copyFileSync(logoSrc, path.join(buildDir, "icon.png"));
  log("copy logo -> build/icon.png");
} else {
  log("警告：未找到 web/public/logo.png，图标缺失");
}

log("done");
