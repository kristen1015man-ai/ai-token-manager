# Sparkloom Studio Desktop（Electron 桌面客户端）

把 Studio 从"解压 zip 双击脚本"升级为正规桌面应用。详细规格见
[`../docs/STUDIO-DESKTOP.md`](../docs/STUDIO-DESKTOP.md)。

## 架构

- 主进程 `src/main/`：创建窗口、用 `ELECTRON_RUN_AS_NODE` 拉起内置 Agent 子进程、注入本地 agent-token。
- 内置 Agent：复用项目根 `agent/`（打包时由 `scripts/prepare-agent.cjs` 复制进 `resources/agent/`，含 node_modules 和平台 native binary）。
- 渲染层：直接加载远程 `https://ai.seapllo.com/studio`（前端零改动），用现有 `#sparkloomAgentToken=` hash 注入鉴权。

## 目录结构

```
desktop/
├── src/main/          # Electron 主进程（index.cjs / agent.js / token.js）
├── src/preload.js     # 受限 IPC 桥
├── scripts/prepare-agent.cjs  # 打包前把 agent/ 准备到 resources/agent/
├── resources/agent/   # （构建时生成）内置 Agent + node_modules
├── build/icon.png     # 应用图标（来自 web/public/logo.png）
├── electron-builder.yml
└── package.json
```

## 开发

```bash
cd desktop
pnpm install          # 装 electron + electron-builder
pnpm prepare-agent    # 把 agent/ 准备到 resources/agent/（含 npm install 装依赖）
pnpm dev              # 启动 Electron（开发态，加载远程 Studio）
```

开发态入口也走 `resources/agent/desktop-entry.mjs`（与打包态一致，含 ELECTRON_RUN_AS_NODE 泄漏防护），所以 **dev 前必须先跑一次 `pnpm prepare-agent`**（首次安装或 `agent/` 有改动后重跑）。

## 打包（Windows x64）

```bash
pnpm build:win        # prepare-agent + electron-builder --win --x64
```

产物在 `dist/Sparkloom Studio Setup x64.exe`。

## 关键约束

- **不单独装 Node**：用 Electron 自带 Node（`ELECTRON_RUN_AS_NODE=1`）。
- **ELECTRON_RUN_AS_NODE 泄漏防护**：Agent 入口 `resources/agent/desktop-entry.mjs` 启动时第一行 `delete process.env.ELECTRON_RUN_AS_NODE`，避免该变量泄漏给 Agent 内部 spawn 的 `claude.exe` / shell 子进程（Claude Code 已知坑）。
- **Agent 在 asar 外**：放 `extraResources`，否则 SDK spawn `claude.exe`（native binary）失败。
- **SDK 无 win32-ia32**：只支持 win-x64 / win-arm64 / mac-x64 / mac-arm64（Phase 4 多平台）。
