# Sparkloom 当前状态交接说明

日期：2026-06-26  
项目路径：`F:\文档\词元管理系统`  
线上域名：`https://ai.seapllo.com`

## 交接结论

当前 Sparkloom 主系统已经上线，核心 API 网关、飞书登录、员工 Key、渠道/模型/计费管理等功能仍是主线系统。新增的 `/studio` 和本地 `Sparkloom Agent` 属于后续扩展能力，目标是做网页端 AI 编程工作台，但当前体验没有达到预期，不建议继续按现状扩大使用。

建议新团队把 `/studio + local agent` 当作一个未成熟的原型模块接手评估。主系统不要因为 Studio 重构而被牵连；优先保证资金、密钥、计费、员工权限、渠道转发稳定。

## 线上部署状态

Railway 当前绑定信息：

- Workspace：`kristen1015man-ai's Projects`
- Project：`heartfelt-education`
- Project ID：`c6e27ae3-1bc5-4f3c-a9f4-9920bb37fb24`
- Environment：`production`
- Service：`web`
- Service ID：`53c3f946-0a9c-4f1c-b14b-4fd4457ab48d`
- Domain：`https://ai.seapllo.com`
- Current deployment ID：`b53f1da1-9202-4fc8-a499-7e9b70e13804`
- Previous known stable deployment before latest Studio change：`c77b0079-d4f9-4a3b-91ef-f5b6bd2fc31d`

最新一次部署内容是 `studio websocket agent sdk 0.4.0`。部署后验证过：

- `https://ai.seapllo.com/api/health` 返回 200。
- `https://ai.seapllo.com/download` 返回 200。
- `sparkloom-agent-0.4.0-windows.zip` 可下载。
- `sparkloom-agent-0.4.0-macos.zip` 可下载。
- `pnpm smoke:production` 通过基础检查；员工真实计费类检查因未提供员工 key 被跳过。

## 当前代码状态

当前工作区不是干净 git 状态，包含大量已经上线或待交接的未提交改动。接手团队必须先做一次代码盘点，不要直接假设 `git status` 中的所有改动都只属于 Studio。

关键新增/修改区域：

- `agent/`：本地 Sparkloom Agent。
- `web/src/app/studio/`：Studio 网页工作台。
- `web/src/app/download/`：Agent 下载页。
- `web/src/app/api/studio/`：Studio 会话、模型、命令记录 API。
- `web/src/lib/studio-db.ts`、`web/src/lib/studio-models.ts`：Studio 数据和模型配置。
- `web/src/generated/studio-agent-release.ts`：Agent 下载包 manifest。
- `scripts/package-agent.mjs`：Agent 打包脚本。
- `docs/STUDIO-AGENT.md`：Studio/Agent 技术说明。
- `proxy/src/routes/anthropic-models.ts`、`proxy/src/services/model-alias.ts`：Anthropic 网关模型别名相关逻辑。

## Studio/Agent 当前实现

当前 `/studio` 的目标是网页端 AI 编程工作台，配合用户本机 `Sparkloom Agent` 使用。

当前实现链路：

1. 用户打开 `/studio`。
2. 用户从 `/download` 下载本地 Agent。
3. Windows 用户解压后运行 `Start Sparkloom.cmd`。
4. Agent 监听 `127.0.0.1:39271`。
5. Agent 生成本机配对 token，并把 token 放到 Studio URL fragment。
6. Studio 将 token 存入浏览器 localStorage。
7. Studio 通过 `GET /health`、`GET /environment`、`GET /claude/status` 检查本地 Agent。
8. 用户在 Studio 新建 `sk-emp-*` Key 并写入本机配置。
9. Studio 通过本地 Agent `/ws` WebSocket 发起任务。
10. Agent 使用 `@anthropic-ai/claude-agent-sdk@0.3.193` 执行任务，并通过 `https://ai.seapllo.com/anthropic` 走 Sparkloom 网关。

注意：旧的 HTTP 执行接口 `/claude/run` 已退役，当前返回 `410`。任务执行不再调用全局 `claude` CLI，也不再依赖 `spawn claude`。

## Agent 0.4.0 下载包

当前线上 manifest：

- Windows：`/downloads/studio-agent/sparkloom-agent-0.4.0-windows.zip`
- Windows SHA256：`ef1f556e70b2db7f6b6669f78cea28ce2139bf06f793084e42525a517635deb7`
- macOS：`/downloads/studio-agent/sparkloom-agent-0.4.0-macos.zip`
- macOS SHA256：`83f7f185225daf3e537ba452c0a07afa5e4a844e5d7ad7acbe758f1309081684`

本地已验证：

- `node --check agent/src/index.mjs` 通过。
- Windows zip 解压后，`npm ci --omit=dev --ignore-scripts --no-audit --no-fund` 通过。
- SDK import 自检通过。
- 临时 Agent 可启动，`/health` 正常，`/ws` 可连接。

未验证：

- 当前 Windows 环境没有可用 bash，因此未执行 macOS `bash -n`。
- 未在真实 macOS 机器上安装测试。
- 未做代码签名、Windows SmartScreen 信誉、macOS notarization。

## 已知问题和风险

### 1. Studio 产品体验未达标

用户反馈“效果不好”。当前页面虽已做会话、模型、权限、文件、Skills、语音入口等，但整体体验仍不等同成熟桌面 AI 编程工具。

建议新团队不要在现有 UI 上小修小补，而是重新定义信息架构和交互：

- 会话管理。
- 项目目录选择。
- 文件读取/上传/引用。
- 模型选择。
- Ask / Plan / Auto 权限模式。
- 工具执行过程可视化。
- 失败恢复。
- 历史记录清理。
- 新手安装引导。

### 2. 浏览器 + 本地 Agent 架构仍有天然复杂度

浏览器不能直接执行本机安装器，也不能直接访问任意本地文件。当前方案依赖本地 Agent 作为桥接服务。这个方向可以继续，但必须把安装、权限、日志、错误处理、升级、卸载做完整。

接手团队需要重点审查：

- Agent 端口只允许 loopback。
- WebSocket token 鉴权是否足够。
- Origin 白名单是否严格。
- 本地 token 生命周期和清理策略。
- Agent 是否可能被其他本地网页滥用。
- Auto 模式是否会执行高风险命令。
- 日志是否泄露 `sk-emp-*`。

### 3. Claude Agent SDK 兼容性要重新验证

当前使用 `@anthropic-ai/claude-agent-sdk@0.3.193`。SDK 内部仍会启动其能力运行时，实际表现、权限控制、工具行为需要真实项目验证。

需要补充的测试：

- Windows 干净机器安装。
- macOS 干净机器安装。
- 中文路径项目。
- 空格路径项目。
- 大项目索引。
- Git 项目修改。
- 文件编辑、创建、删除。
- 长任务取消。
- 网络断开重连。
- Key 删除/禁用后的错误提示。
- 月度额度不足时的错误提示。

### 4. 主系统资金安全仍应优先

Sparkloom 主系统涉及真实渠道密钥、员工 Key、计费、额度、余额提醒。后续团队接手前必须优先回归：

- 员工 Key 只能显示一次明文。
- 后续只能删除/新建，不能再次明文查看。
- 禁用渠道不能出现在余额不足提醒中。
- 计费按北京时间还是上游 UTC 口径需要文档化。
- 缓存命中 token、未命中 token、输出 token 的价格计算需逐渠道确认。
- 个人额度、部门额度、管理员权限、财务权限需要重跑场景测试。
- 飞书通知接收人、群组、排行榜发送需要生产验证。

### 5. 当前 git 工作区未形成正式版本标签

当前代码没有做干净 commit/tag。换团队时建议先由接手团队建立新的 Git 仓库或分支，把当前交接包作为基线导入，然后再做审计。

如果继续在当前目录开发，建议第一步：

```powershell
git status --short
pnpm install --frozen-lockfile
pnpm --filter web build
pnpm smoke:production
```

## 推荐接手顺序

1. 先保护主系统：不要先重构计费、密钥、权限、渠道转发。
2. 完整跑一遍生产只读 smoke。
3. 建立测试账号和测试员工 Key，不要用管理员真实 Key 做 Studio 测试。
4. 明确 Studio 是否继续做浏览器 + 本地 Agent，还是改成 Electron/Tauri/原生桌面壳。
5. 如果继续 WebSocket + Agent SDK，先重写安装器、日志、错误处理和 UI 流程。
6. 给 Agent 做签名、自动升级、卸载清理。
7. 做 UAT 表：安装、配置、发送、改文件、取消、额度不足、Key 禁用、离线恢复。

## 本地开发命令

安装依赖：

```powershell
pnpm install --frozen-lockfile
```

构建 Web：

```powershell
pnpm --filter web build
```

打包 Agent：

```powershell
pnpm agent:package
```

本地启动 Agent：

```powershell
cd agent
npm install --omit=dev --no-audit --no-fund
node src/index.mjs
```

生产基础 smoke：

```powershell
pnpm smoke:production
```

Railway 查看状态：

```powershell
railway status
railway deployment list --service web --environment production --json
```

## 不应放入交接包的内容

交接包不应包含：

- `.env`
- `.env.production`
- 真实渠道密钥。
- `web/data.db` 或生产数据库备份。
- `node_modules`
- `.next`
- `.git`
- 本机用户目录下的 `.sparkloom`
- 任何 `sk-emp-*` 明文 Key。

## 交接包说明

本次交接包会放在：

```text
F:\文档\词元管理系统\handoff-packages\
```

交接包目标是给新团队看当前代码、文档和下载包，不作为正式发布包。正式发布仍需要新团队重新审计、打 tag、生成 release notes、签名安装包。

