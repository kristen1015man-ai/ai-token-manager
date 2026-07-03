# Sparkloom Studio Desktop

Sparkloom Studio 的原生桌面客户端。把现有的"解压 zip 双击脚本"分发方式，升级为正规的安装软件，解决两类线上痛点：**未装 Node 的用户双击闪退**、**精简掉密钥入口后用户无法配置 `sk-emp-*` 凭证**。

本文是桌面端的产品规格 + 架构 + 开发计划合一文档，与 [STUDIO-AGENT.md](./STUDIO-AGENT.md) 并列。桌面端复用现有 Web Studio（`https://ai.seapllo.com/studio`）和现有本地 Agent（`agent/`），不改动主系统一行代码。

---

## 1. 背景与痛点

### 现状分发方式
`pnpm agent:package` 生成 `sparkloom-agent-{version}-{windows,macos}.zip`。用户解压后双击 `Start Sparkloom.cmd`（Windows）或 `start-macos.sh`（macOS），PowerShell/Bash 脚本检测环境、用 winget/brew 装 Node、拉起 Agent、打开浏览器。

### 两个线上痛点
1. **闪退**：用户电脑没装 Node.js 时，启动脚本虽写了 `pause`，但多种情况（错误码非 1、在压缩包预览里直接双击、PowerShell 执行策略受限）窗口一闪而过，用户看不到任何提示。
2. **Key 断链**：`STUDIO-AGENT.md` 的 User Flow 第 5 步是"用户创建 Studio key，明文显示一次"。后来 UI 精简删掉了密钥入口，用户重新连接时拿不到 `sk-emp-*`，Agent 写不进本机配置，连不上网关。

### 不变的硬约束
- 主系统（网关 / 飞书登录 / 员工 Key / 渠道 / 模型 / 计费）**一个字符不能动**。
- Key 不落地：员工密钥走代理服务器，Agent 只在本机 `~/.sparkloom/claude-code.env` 持有 `sk-emp-*`，不外传。
- 内核是 Claude Code（`@anthropic-ai/claude-agent-sdk`），功能必须是 SDK 能实现的。
- 沿用 [STUDIO-AGENT.md Safety Rules](./STUDIO-AGENT.md#safety-rules)：网页不直接跑安装器、Agent 不存/不读供应商 Key、不日志明文 `sk-emp-*`、不以管理员运行。

---

## 2. 目标用户体验

| 阶段 | 用户动作 | 系统行为 |
|------|---------|---------|
| **下载** | 从 `/download` 下载一个安装包（.exe / .pkg） | 单文件，无需解压 |
| **安装** | 双击安装包，下一步 | 装入系统，创建桌面快捷方式「Sparkloom Studio」 |
| **首次启动** | 双击桌面快捷方式 | 弹原生窗口，显示启动引导（检测环境、配置凭证），用户看到进度 |
| **自动配置** | 无需任何操作 | 自动检测本机 Agent 配置 → 自动为这台设备创建/复用 `sk-emp-*` → 写入本机 → 拉起 Agent |
| **进入主页** | 无需任何操作 | 窗口内直接加载 Studio 主页，已登录态、已连通 Agent，立即可对话 |
| **日常使用** | 双击快捷方式即进 | 秒开（Agent 已驻留或快速拉起） |
| **更新** | 应用提示"发现新版本" | 用户点「更新」，后台下载增量/全量，提示重启 |

**核心体验目标**：从"下载"到"开始第一次对话"，全程零配置、零命令行、零外部依赖。

---

## 3. 技术架构

### 技术选型（已确认）
- **框架**：Electron。自带 Node 运行时（用户无需装 Node，闪退从根消失）；`electron-builder` 一键多平台打包；`electron-updater` 自动更新；`BrowserWindow` 内嵌 Studio 页面。
- **macOS 构建**：GitHub Actions CI（本机 Windows 无法产出 mac 包）。
- **Claude CLI**：**不单独安装**。`@anthropic-ai/claude-agent-sdk@0.3.193` 已通过 `optionalDependencies` 按平台打包 native binary（如 `@anthropic-ai/claude-agent-sdk-darwin-arm64`）。Electron 打包时必须为每个目标平台保留对应的 SDK native binary。

### 进程结构
```
SparkloomStudio.exe (Electron 主进程)
├── main process（electron-main/）
│   ├── 窗口管理：创建 BrowserWindow 加载 https://ai.seapllo.com/studio
│   ├── Agent 生命周期：spawn 内置 Agent（子进程，监听 127.0.0.1:39271）
│   ├── 环境自检：Python / 代理 / 端口冲突
│   ├── 凭证自动配置：调主系统 API 拿 sk-emp-* → 写入本机 ~/.sparkloom/
│   ├── 自动更新：electron-updater 检查新版本
│   └── 安全：只绑 127.0.0.1，token 本地签发，不外传
├── renderer = Web Studio（远程页面，非本地打包）
└── 内置资源 app/resources/
    ├── agent/（现有 agent/src + node_modules，含平台 SDK binary）
    └── skills/（现有打包技能）
```

### 与现有系统的关系
- **Web Studio**：完全复用，不改动。桌面端只是用 BrowserWindow 加载它，并注入本地 `agent-token`。
- **本地 Agent**：完全复用 `agent/src/index.mjs`。桌面端 main 进程 spawn 它，复用现有 WS 协议和所有 HTTP 端点（`/health`、`/claude/status`、`/claude/configure`、`/ws` 等）。
- **主系统**：零改动。桌面端通过现有 Web API（`/api/studio/bootstrap`、`/api/user/key`）交互。

### 代码位置
桌面端代码独立目录：`F:\文档\词元管理系统\desktop\`，与 `web/`、`agent/`、`proxy/` 并列。不污染现有模块。

---

## 4. 核心功能点

### F1 安装包 + 桌面快捷方式
- Windows：NSIS 安装器（`.exe`），支持 x86 和 x64。
- macOS：`.dmg`，支持 Intel（x64）和 Apple Silicon（arm64）。
- 安装后自动创建桌面快捷方式 / Applications 入口。
- 卸载干净：移除程序文件；保留用户配置 `~/.sparkloom/`（用户数据不丢）。

### F2 自带 Node 运行时
- Electron 自带 Node，用户**无需预装 Node**。
- Agent 作为子进程用 Electron 内置 Node 运行，或打包 portable node。
- 彻底消除"没装 Node 闪退"。

### F3 首次启动环境自检
- **Node**：自带，跳过。
- **Python**：检测 `python --version`。缺失时**软提示**（部分 MCP/工具需要），引导安装但不阻塞启动。
- **Claude CLI**：不装（SDK 自带）。
- **代理检测**：检测系统代理设置（环境变量 `HTTP_PROXY` / `HTTPS_PROXY`、Electron `session.proxy`）。若检测到代理或下载失败，**明确弹窗提示**"检测到代理环境，若下载/连接失败请检查代理设置"，避免用户误判为 bug。
- **端口冲突**：39271 被占用时，按现有 Agent 逻辑处理或提示。
- 所有自检结果在启动引导界面**可见**（进度 + 状态），不再有"黑屏闪退"。

### F4 凭证（Key）启动自动配置 ★核心★
详见第 5 节。目标：**启动即自动配好，零点击，不撞 5 个/用户上限**。

### F5 自动更新
详见第 6 节。目标：**新版上传后，用户点「更新」即可，不重复下载整包**（electron-updater 支持差量/全量）。

### F6 多平台多架构
- Windows：x86 + x64
- macOS：Intel（x64）+ Apple Silicon（arm64）
- 共 3 套安装包，由 GitHub Actions CI 一次性构建发布。

---

## 5. 凭证（Key）启动自动配置方案 ★核心★

### 现有技术链路（已通，只差在桌面端接上）
| 环节 | 接口 | 作用 |
|------|------|------|
| 列密钥 | `GET /api/user/key` | 返回用户已有密钥列表（**仅 maskedKey 脱敏，无明文**） |
| 新建密钥 | `POST /api/user/key` | 返回明文 `sk-emp-*`（限 5 个/用户，冷却 60s） |
| 引导数据 | `GET /api/studio/bootstrap` | 返回 `gateway.anthropicBaseUrl` + `apiKeys` 列表 |
| 本机配置状态 | `GET http://127.0.0.1:39271/claude/status` | 返回本机是否已配置 |
| 写入本机配置 | `POST http://127.0.0.1:39271/claude/configure` | header `x-sparkloom-agent-token` + `x-sparkloom-local-confirm: configure-claude-code`，body `{baseUrl, token, model}`，写入 `~/.sparkloom/claude-code.env` |

### 核心难点
`GET /api/user/key` 只返回脱敏的 `maskedKey`，**复用已有密钥拿不到明文**。直接每次新建会撞主系统 5 个/用户上限。

### 方案：设备密钥 + 本机明文缓存
1. **首次启动**（本机 `claudeGatewayStatus().configured === false`）：
   - 调 `POST /api/user/key` 新建一个密钥，**命名 = 设备名**（如 `Desktop-Win-小明`），便于用户在后台识别管理。
   - 拿到明文 `sk-emp-*` → 写入本机 `~/.sparkloom/claude-code.env`（复用现有 `/claude/configure`）。
   - 明文**仅存本机配置文件**（沿用现有安全模型），桌面端不在别处缓存。
2. **后续启动**（本机已配置）：直接读本机配置，不新建，不联网拿密钥。零开销。
3. **本机重装/换机**（本机未配置但用户已有密钥）：
   - 优先尝试新建设备密钥。
   - 若已达 5 个上限（`POST` 返回 400「最多只能保留 5 个」）：**弹窗引导**"您的密钥已达上限，请在后台删除不用的密钥"，并给出后台密钥管理链接。不静默失败。
4. **冷却**（`POST` 返回 429）：短暂等待或提示，不阻塞主流程（本机若已配置可继续用旧的）。

### 流程图
```
桌面端启动
  ↓
GET /claude/status（本机 Agent）
  ↓ configured?
  ├─ 是 → 直接拉起 Agent → 加载 Studio（结束）
  └─ 否 → 用户已登录?
            ├─ 否 → 引导登录飞书（加载 Studio 登录页）
            └─ 是 → POST /api/user/key 建设备密钥
                     ├─ 成功 → 拿明文 → POST /claude/configure 写入 → 拉起 Agent
                     ├─ 400 上限 → 弹窗引导清理密钥
                     └─ 429 冷却 → 提示稍后重试
```

### 与"不用点一键连接"的契合
整个流程在 main 进程启动时**自动完成**，用户只看到启动引导界面的进度条（"正在配置凭证..."），无需任何点击。配置成功后窗口自动跳转到 Studio 主页。

---

## 6. 自动更新方案

### 技术方案：electron-updater + GitHub Releases
- `electron-updater`（electron-builder 配套）检查 `latest.yml`（Win）/ `latest-mac.yml`（Mac）版本元数据。
- 检测到新版本 → 后台下载 → 下载完提示"重启更新"。
- 支持差量更新（Win NSIS 差量补丁），减少下载量。

### 更新源
- **首选 GitHub Releases**：CI 构建完直接 publish，零额外存储成本，与 mac 构建方案天然契合。
- **备选对象存储**：若 GitHub Releases 在用户网络不稳定（国内），可切换到 Cloudflare R2 / 阿里云 OSS，改 `electron-updater` 的 feed URL 即可。
- 配置项通过环境变量注入，不硬编码。

### 版本管理
- 版本号语义化（`0.5.0` → `0.5.1` 补丁 / `0.6.0` 功能 / `1.0.0` 正式）。
- 每次发版 CI 自动出 3 套包 + 对应 `latest*.yml` + SHA256 校验。
- 强制更新阈值：可选配置最低安全版本，低于该版本强制更新（应对安全漏洞）。

---

## 7. 分 Phase 开发计划

每个 Phase 完成后必须通过 [CLAUDE.md 四步走验证]：Code Review（对照本文档）→ 测试完整性 → `tsc --noEmit` 零错误 → 功能测试（本机能装能跑）。

### Phase 1：Electron 骨架（先让它在 Windows x64 跑起来）
**交付物**
- `desktop/` 目录：Electron 工程（main 进程、package.json、electron-builder 配置）。
- main 进程能 spawn 内置 Agent（子进程），监听 39271。
- BrowserWindow 加载 `https://ai.seapllo.com/studio`，注入本地 `agent-token`（复用现有 hash 注入机制）。
- electron-builder 产出 **Windows x64** NSIS 安装包（`.exe`），含桌面快捷方式。
- 内置 Agent + node_modules + 平台 SDK binary 正确打包进 `app/resources/`。

**验证**：本机（Windows x64）安装 → 双击桌面快捷方式 → 弹出原生窗口 → 看到 Studio 登录页 → Agent 进程存在 → 不闪退。

### Phase 2：环境自检 + 凭证自动配置
**交付物**
- 首次启动引导界面（原生窗口内 HTML/React）：显示环境检测进度（Node 自带 ✓ / Python 检测 / 代理检测）。
- 凭证自动配置完整实现（第 5 节方案）：检测本机 → 自动建设备密钥 → 写入 → 拉起 Agent。
- 上限/冷却的兜底提示。
- 代理检测与失败提示。

**验证**：全新安装（清空 `~/.sparkloom/`）→ 双击 → 自动完成配置 → 进入 Studio 已登录已连通 → 发消息能正常跑 Claude Code。模拟 5 个密钥上限 → 弹窗引导。

### Phase 3：自动更新
**交付物**
- `electron-updater` 集成，feed URL 可配置。
- 应用内更新提示 UI（发现新版本 → 下载进度 → 重启更新）。
- 版本 manifest（`latest.yml` / `latest-mac.yml`）。
- 决定更新源（GitHub Releases 或对象存储），配置注入。

**验证**：发一个低版本 → 再发高版本 → 低版本应用检测到更新 → 下载 → 重启后为高版本。

### Phase 4：GitHub Actions CI + 多平台多架构
**交付物**
- `.github/workflows/build-desktop.yml`：矩阵构建 win-x64 / mac-x64 / mac-arm64（共 3 套；mac-x64 用 macos-13 Intel runner 避免 arm64 交叉编译残包）。
- CI 自动 publish 到 GitHub Releases，生成 `latest*.yml` + SHA256。
- 版本号从 git tag / package.json 读取。
- 文档：发版流程说明。

**验证**：打 tag → CI 跑通 → Releases 出现 3 套包 + manifest → feed URL 可被应用读取。mac 包在真机或 CI 校验通过。

### Phase 5：打磨与发布
**交付物**
- 应用图标（各平台规格）。
- 首次启动动画 / 加载态优化。
- 错误兜底（网络断开、Agent 崩溃、登录过期）。
- 卸载清理策略（保留 `~/.sparkloom/` 用户数据）。
- macOS 代码签名 + 公证（可选，未签名会提示"身份不明开发者"；广泛分发前必做）。
- Windows 代码签名（可选）。
- `/download` 页面接入桌面端下载入口（替换或并列现有 zip）。

**验证**：完整回归（含主系统不受影响的 health check）→ 上线 → 真人用户灰度。

---

## 8. 安全约束（沿用 + 新增）

沿用 [STUDIO-AGENT.md Safety Rules](./STUDIO-AGENT.md#safety-rules)，桌面端额外：
- 本地 `agent-token` 仅 main 进程持有并注入 renderer，不外传、不日志。
- `sk-emp-*` 明文仅存本机 `~/.sparkloom/claude-code.env`（文件权限 600），桌面端不在内存外/日志/遥测中保留。
- 自动更新只从配置的可信 feed URL 拉取，校验 SHA256。
- Electron 开启 `contextIsolation`、禁用 `nodeIntegration`（renderer 是远程页面，安全隔离）。
- 远程 renderer（Studio 页面）通过 `preload.js` 暴露受限 IPC，不能直接访问 Node。

---

## 9. 风险与待决策

| 项 | 状态 | 说明 |
|----|------|------|
| macOS 签名/公证 | **内部不签名（已定）** | 当前仅几人用 Mac，零成本方案：随包附「双击放行.command」脚本（自动 `xattr -dr com.apple.quarantine` 去隔离 + 打开 app）+ 下载页图文指引（系统设置→隐私与安全性→仍要打开）。用户双击脚本输一次密码即永久放行，非技术人也能做。量级扩大或对外分发再花 $99/年 Apple Developer 签名公证。注：macOS 15+ 老办法"右键→打开"单独已失效，必须走系统设置或 xattr。 |
| Windows 签名 | **内部不签名（已定）** | SmartScreen 首次拦截，点「仍要运行」即可，配图文指引。内部小范围够用，公开分发再签。 |
| 更新源 | 待决策 | GitHub Releases（免费、国内可能慢）vs 对象存储（国内快、要钱）。建议先用 Releases，灰度后视情况切。 |
| Agent 子进程方式 | 待定 | 用 Electron 内置 Node spawn，还是打包独立 portable node。Phase 1 定。 |
| 安装包体积 | 接受 | Electron 基础 ~90MB + Agent SDK binary，总量约 100-130MB。VS Code 级别，可接受。 |
| 与现有 zip 共存 | 待决策 | 过渡期 zip 和桌面端并存，还是桌面端稳定后下线 zip。建议并存到 Phase 5。 |

---

## 10. 技术决策记录

- **为什么选 Electron 而非轻量 installer**：用户要"自动更新点击即更新 + 多平台多架构 + 双击进主页"。Electron 自带运行时（消除闪退根因）+ electron-builder（成熟多平台）+ electron-updater（成熟自动更新）+ 内嵌页面（真原生体验）。轻量方案要自造更新轮子，不可靠。包体积 ~100MB 是正规桌面软件常态。
- **为什么不单独装 Claude CLI**：`@anthropic-ai/claude-agent-sdk` 已通过 `optionalDependencies` 按平台打包 native binary（官方文档确认）。打包时为每个目标平台保留对应 binary 即可。
- **为什么用 GitHub Actions 出 mac 包**：macOS 安装包只能在 macOS 或 macOS CI 环境构建，本机 Windows 无法产出。CI 一次构建 3 套包，自动化。
- **为什么凭证方案用"设备密钥"而非"复用已有"**：`GET /api/user/key` 只返回脱敏值，复用拿不到明文。每台设备新建一个命名密钥（设备名），用户在后台可识别管理，且正常用户不会撞 5 个上限。

---

## 实施进度（2026-07-03）

### ✅ Phase 1（骨架）完成
Electron 工程 `desktop/`，spawn 内置 Agent，BrowserWindow 加载 Studio，Win64 NSIS 安装包产出。体积压缩 603→552MB（locales 只留中英 + node_modules 清理）。

### ✅ Phase 2（Key 启动自动配置）完成
- 前端 `StudioClient.tsx` 加 `autoConfigureDesktopKey`：检测桌面端（`window.sparkloomDesktop` 由 preload 注入）→ 登录后查本机 `/claude/status` → 未配则 `POST /api/user/key` 建设备密钥 → 写入本机 `/claude/configure`。已部署 web（ba17ddb9）。
- 桌面端 `ensureFramework` 预置框架到 `~/.sparkloom/claude-code`（claude.exe 全局配置目录），CLAUDE.md 角色 + skills + agents 对所有项目生效，不覆盖用户已有。

### ✅ Phase 3（自动更新）完成
- `desktop/src/main/updater.cjs`：electron-updater 封装，发现新版提示后台下载、下载完提示重启；未装依赖时 no-op。
- electron-builder `publish: github`，验证 app-update.yml 生成 + electron-updater 打进 asar。

### ✅ Phase 4（CI 多平台）配置完成（需用户触发）
`.github/workflows/build-desktop.yml`：矩阵 win-x64/mac-x64/mac-arm64（共 3 套；mac-x64 用 macos-13 Intel runner 避免残包；不出 win-arm64，ARM Windows 用户用 x64 包 WoW64 可跑），推 `v*` tag 自动构建 + action-gh-release 单点上传 Releases。需用户：GitHub repo（= publish 配置的 owner/repo）+ 推 tag 触发。

### ✅ Phase 5（打磨）完成（核心，深度打磨留后续）
- 图标：`web/public/logo.png`（1024²）→ electron-builder 自动转 ico。
- 卸载：NSIS `deleteAppDataOnUninstall: false`（保留用户 `~/.sparkloom` 数据）。
- 白屏：`ready-to-show` 处理。
- 框架预置：1.5MB 样板整套，首次启动自动预置。

### ⚠️ 已知限制（留后续）
- **hooks 已全局化（不做项目级）**：`ensureFramework()` 预置后会把 settings.json 里 hooks 脚本路径从 `$CLAUDE_PROJECT_DIR/.claude/hooks` 改写为 `$CLAUDE_CONFIG_DIR/hooks`（`patchSettingsHooks()`），指向全局配置目录 `~/.sparkloom/claude-code/hooks/`，所有项目共用一份——detect-feedback-signal / check-evolution / pre-commit-check / auto-push / mark-review-needed / stop-gate 六个全部生效。settings.json 本身就在 claude.exe 全局配置目录（`CLAUDE_CONFIG_DIR`），是全局 scope，所有项目都加载。
- **hooks 依赖 Git Bash（启动检测 + 引导安装）**：Claude Code 在 Windows 跑 hooks/Bash 工具需要 Git Bash。桌面端启动时检测系统 Git Bash（PATH 的 bash.exe + 常见安装路径），有就用系统的；没有则弹窗引导用户去官网装 Git for Windows（这是 Claude Code 在 Windows 的官方系统要求）。**不预制 bash** —— 完整 PortableGit ~150MB 太大；MinGit 精简版只含 git+coreutils、**不含 bash.exe**，没法用。
- **杀端口 hook 跨平台**：样板里那个杀端口 hook 是内联 PowerShell 命令（`powershell -Command ...`），mac/linux 上 `Bash(pnpm dev*)` 触发时会因无 powershell 失败，属非阻塞错误（不影响主流程），如需跨平台可后续改成 `lsof`/`taskkill` 分平台脚本。
- **环境自检 UI 未做**：桌面端 agent 自动起，不太会 offline；前端已有 offline 提示。
- **代码签名**：内部不签（mac 右键打开 / 系统设置→隐私与安全性→仍然打开；Windows SmartScreen 仍要运行）。
- **mac 自动更新失效**：未签名 → electron-updater 在 mac 上无法自动更新（Squirrel.Mac 校验签名失败），mac 新版需手动下载 dmg 覆盖；Windows 自动更新不受影响。
- **更新源占位**：`seapllo/sparkloom-studio-desktop`，用户改实际 repo。

### 用户需做的
1. **GitHub repo**：建 `sparkloom-studio-desktop`（或改 `electron-builder.yml` 的 publish），推代码。
2. **发版**：推 `v*` tag → CI 出 3 套包到 Releases → 桌面端 updater 自动检查。
3. **实测**：装 `desktop/dist/Sparkloom Studio Setup 0.1.0.exe`（554MB），双击 → 框架预置 + agent 起 + 登录飞书 → key 自动配 → 用 Claude Code。

## 变更记录

- 2026-07-03：初版。基于用户需求（正规安装软件 + 自带运行时 + 自动更新 + 环境自检 + 多平台 + Key 启动自动配置）+ 联网核实（Electron、Agent SDK 自带 binary）+ 现有代码审查（Agent / bootstrap / user-key API）生成。
