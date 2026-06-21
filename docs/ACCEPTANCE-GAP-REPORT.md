# 接收方交接审查退回清单

最后更新：2026-06-20

本文档用于交接前严格签收。口径按“接收方需要重金购买项目”的标准执行，不只看功能是否可用，还看资金安全、密钥安全、权限边界、发布证据和后续维护可接手性。

## 1. 本地验证结果

已通过：

- `pnpm install --frozen-lockfile`
- `pnpm test`
- `pnpm handoff:status`
- `pnpm handoff:uat`
- `pnpm handoff:readiness`
- `pnpm --filter web lint`
- `pnpm --filter web build`
- `pnpm --filter proxy build`
- `pnpm --filter shared db:migrate`，使用临时 DB 烟测
- `pnpm audit --prod --registry=https://registry.npmjs.org`
- `git diff --check`
- 阻断关键字扫描：固定员工 key、公开 admin internal 绕过、废弃 `ADMIN_` + `EMAILS`、`INTERNAL_API_` + `ALLOWED_PATHS` 均无命中
- tracked 文件真实形态密钥扫描，无真实飞书 Secret、供应商 Key、员工 Key 命中
- admin/internal route guard 目录级扫描：所有 `/api/admin/**/route.ts` 有 `requireAdmin` 或 `requireRole`，所有 `/api/setup/**/route.ts` 有 `requireAdmin`，所有 `/api/internal/**/route.ts` 有内部 Bearer 守卫
- tracked env 文件 Secret 扫描：`SECRET`、`TOKEN`、`PASSWORD`、`API_KEY`、`APP_SECRET` 类变量不允许出现具体值，只允许空值或占位符
- `node --check railway/start.mjs`
- Railway 生产入口负向测试：弱 JWT、重复 `cli_` 前缀飞书 App ID、危险开关开启均被拒绝启动
- `pnpm smoke:production`：线上非计费 smoke 通过，public health 正常，危险内部接口公网屏蔽正常

## 2. 已完成的代码级整改

- 公网 admin/setup 路由不再接受 `INTERNAL_API_KEY`，只接受管理员 session。
- 定时任务改走 `/api/internal/admin/*` 内部路由。
- `web/src/proxy.ts` 内部 Bearer 比较改为固定时间比较。
- Hono proxy 渠道接口在渠道 key 解密失败时排除该渠道，避免把 `enc:v1:*` 密文样式值转发给上游。
- 旧 Next 代理缓存分支同样增加不可解密渠道排除。
- `docker-compose.yml` 注释改为当前架构：web 是唯一 DB owner，proxy 只持久化 usage 队列。
- `auditLog()` 已改为 fail-closed，写入失败会抛错，不再静默吞掉。
- `/api/admin/cleanup-execute` 已改为生产环境不可开启，只允许非生产且显式设置 `ENABLE_CLEANUP_ENDPOINT=true`。
- `/api/health` 已增加 encrypted secret 抽样解密检查；解密失败时 health 进入 degraded。
- `/api/health` 已增加 DB 文件所在目录、usage queue、dead-letter 目录的持久写入检查。
- `/health` 已增加 proxy usage queue/dead-letter 路径可写检查。
- 生产上游 base URL 已增加 host allowlist，默认只允许 DeepSeek、SiliconFlow、GLM、OpenAI、Anthropic。
- 后台渠道保存已复用上游安全校验，非法状态、非法余额同步模式、未批准供应商域名会在保存时被拒绝。
- 管理员通知接收人已改为统一 `parseRoles()` 精确判断，不再用 SQL 模糊匹配管理员角色。
- Railway 生产入口已增加 fail-fast 校验：`NODE_ENV=production` 或 `RAILWAY_ENVIRONMENT_NAME=production` 都按生产处理，弱密钥、占位符、飞书 App ID 配错、危险开关、非 HTTPS/CORS 通配符、无持久卷都会拒绝启动。
- 根目录旧 `seed.ts`、`seed-mock.ts` 已移出正式交接包。
- `proxy/src/services/usage.ts` 已删除历史死代码块。
- 新增 CI 工作流与 handoff gate。
- 新增 checked-in DB migration runner。
- `reset-billing` 和 Proxy usage queue 清理已增加维护开关和确认头，不再只依赖 `INTERNAL_API_KEY`。

## 3. 当前签收结论

当前代码层面的 P0/P1 阻断已处理到可进入真实数据 UAT 的状态。

正式交接签字前，接收方仍需要拿到生产平台证据、备份恢复证据、线上 smoke/UAT 证据和资产交割记录。这些不是本地代码能单方面证明的内容。

## 4. 仍需补齐的签收证据

### 4.1 生产 DB 单写约束

证据文件：

- `web/src/lib/db.ts`
- `railway/start.mjs`
- `docs/HANDOVER.md`

现状：

- 当前生产是 sql.js SQLite 文件，web 进程把内存库保存到 `/data/data.db`。
- proxy 不直接写 DB，只通过内部 HTTP API 调 web。
- 仍需要证明线上 Web 只有一个写入实例，不存在多个副本或滚动发布期间两个 Web 进程同时写同一个 volume。

签收要求：

- 提供 Railway 当前 replica=1、volume mount、deploy/restart 策略的脱敏截图或导出。
- 发布和回滚前要有“停止写流量/维护窗口/先备份后发布”的操作要求。
- 如果后续要多实例或高可用，必须迁移到 PostgreSQL 或引入外部事务存储。

### 4.2 自动备份和恢复演练

证据文件：

- `docs/backup-restore.md`
- `docs/OPERATIONS.md`

现状：

- 文档描述了备份恢复要求。
- `reset-billing` 会生成本地备份，但本地 volume 内备份不能替代生产灾备。
- 仓库内未交付独立自动备份任务、外部受控存储位置、最近备份日志和恢复演练记录。

签收要求：

- 交付独立于应用进程的定时备份方案。
- 备份至少覆盖 `data.db`、`usage-queue.jsonl`、`usage-dead-letter.jsonl`。
- 提供最近一次恢复演练记录：执行人、时间、源文件、恢复位置、校验结果。

### 4.3 高危操作审批和演练记录

证据文件：

- `web/src/app/api/internal/admin/reset-billing/route.ts`
- `web/src/app/api/setup/seed/route.ts`
- `web/src/app/api/admin/cleanup-execute/route.ts`

现状：

- `/api/setup/seed` 生产默认禁用且只允许本地。
- `/api/admin/cleanup-execute` 已经生产不可开启。
- `reset-billing` 是内部接口，但仍属于会清空计费记录的高危操作。

签收要求：

- `reset-billing` 必须有演练记录、前置备份、操作审批和回滚步骤；执行时需要临时开启 `ENABLE_INTERNAL_BILLING_RESET=true`、`ENABLE_PROXY_USAGE_QUEUE_CLEAR=true`，并发送 `x-sparkloom-maintenance-confirm: reset-billing-usage`，执行后立刻关闭。
- cleanup 如果后续确需生产使用，应改为一次性脚本或短期签名 token，不应恢复为常驻公网 API。

### 4.4 线上健康检查和 smoke 证据

证据文件：

- `web/src/app/api/health/route.ts`
- `proxy/src/index.ts`
- `docs/RELEASE-CHECKLIST.md`
- `docs/HANDOFF-EVIDENCE-2026-06-20.md`

现状：

- 本地构建和门禁通过。
- health 已能检查必填 env、DB 表、DB 可写、DB 文件目录可写、web/proxy usage queue 和 dead-letter 目录可写、encrypted secret 抽样解密。
- 2026-06-20 已完成 Railway production 部署和线上 health 取证。
- 非计费线上 smoke 已通过：`pnpm smoke:production` 返回 `ok=true`，覆盖 `/health`、`/api/health`、`/api/internal/admin/backup`、`/api/internal/admin/reset-billing`、`/api/auth/dev-login`、`/api/setup/seed`。
- 仍缺少真实登录、真实员工 API 调用、usage 入库、余额同步、飞书通知的业务 UAT 记录。

签收要求：

- 线上 `/api/health` 详细输出，敏感值必须脱敏：已记录。
- 线上 `/health` 输出：已记录。
- 非计费公开 smoke：已记录。
- 登录、`/v1/models`、小额 chat、usage 入库、余额同步、飞书通知的 smoke 记录：待业务 UAT。
- 员工 Key 技术命令：`SPARKLOOM_EMPLOYEE_API_KEY=sk-emp-... node scripts/production-smoke.mjs --base https://ai.seapllo.com`。
- 小额计费技术命令：`SPARKLOOM_EMPLOYEE_API_KEY=sk-emp-... node scripts/production-smoke.mjs --base https://ai.seapllo.com --allow-billable --chat-model <model>`。
- 小额流式技术命令：在小额计费命令后追加 `--include-stream`。
- 脱敏证据包命令：`SPARKLOOM_EMPLOYEE_API_KEY=sk-emp-... pnpm handoff:uat -- --allow-billable --chat-model <model> --include-stream --out <受控目录>`，正式签收要求 `formalBusinessUatComplete=true`。
- 最终签收缺口报告命令：`pnpm handoff:readiness -- --uat-evidence <uat.json> --backup-verification <backup.json> --asset-signoff <asset-file>`。
- 最终签收强制门禁命令：`pnpm handoff:final -- --uat-evidence <uat.json> --backup-verification <handoff-backup-restore-signoff.json> --asset-signoff <handoff-asset-signoff.json>`。

### 4.5 远端 CI 和最终发布证据

证据文件：

- `.github/workflows/ci.yml`
- `docs/RELEASE-CHECKLIST.md`

现状：

- CI workflow 已加入。
- 本地绿色不能替代远端 CI 和生产 deployment 记录。
- 当前仓库本地未配置 `origin` remote，无法从本机直接触发远端 CI。
- 当前 Railway production deployment `d96ff72c-f4a1-45ec-ae18-bf4168faf442` 已成功且在线，详见 `docs/HANDOFF-EVIDENCE-2026-06-20.md`。

签收要求：

- 最终 commit/tag：已记录到 `docs/HANDOFF-EVIDENCE-2026-06-20.md`。
- Railway deployment 编号和构建日志：已记录到 `docs/HANDOFF-EVIDENCE-2026-06-20.md`。
- 远端 CI 绿色截图或日志：待配置 remote 后补齐。
- 回滚入口：Railway deployment history 可回滚到上一成功部署。

### 4.6 结构化资产交割证据

证据文件：

- `docs/HANDOFF-ASSET-SIGNOFF.template.json`
- `scripts/handoff-readiness-report.mjs`

现状：

- 已新增资产交割 JSON 模板。
- `pnpm handoff:readiness` 已改为校验资产签收文件结构，不再只判断文件是否存在。
- `asset-handoff` 需要以下八项都通过：代码仓库、Railway 项目、域名/DNS、飞书应用、供应商账号、通知群、生产密钥库、备份存储。

签收要求：

- 接收方复制模板到公司受控目录，填写实际 `owner`、`permission`、`evidenceRef`。
- 每项资产必须 `complete=true`，否则 readiness report 保持 `formalSignoffReady=false`。
- 签收文件不得包含明文 Key、Secret、cookie、token 或供应商真实密钥。
- 资产签收文件应作为受控证据归档，不提交 Git。

### 4.7 结构化备份恢复证据

证据文件：

- `docs/HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json`
- `scripts/verify-sqlite-backup.mjs`
- `scripts/handoff-readiness-report.mjs`

现状：

- 已新增备份恢复 JSON 模板。
- `pnpm handoff:readiness` 已改为要求结构化灾备签收；单独的 `verify-sqlite-backup.mjs` 输出不能再让 `backup-restore` 通过。
- `backup-restore` 需要以下四项都通过：SQLite 校验、外部公司受控存储、临时环境恢复演练、回滚演练。

签收要求：

- 接收方复制模板到公司受控目录，填写 `sqliteVerification`、`externalStorage`、`restoreDrill`、`rollbackDrill`。
- SQLite 校验必须包含 `ok=true`、`integrity=ok`、`missingTables=[]`、`sha256`、`size`、`evidenceRef`。
- 外部存储必须包含 owner、locationRef、evidenceRef、retentionPolicy。
- 恢复演练必须包含 executor、executedAt、environment、evidenceRef、healthCheckRef。
- 签收文件不得包含明文 Key、Secret、cookie、token 或生产数据库明文路径中不应公开的敏感信息。

## 5. P2 建议整理

- 多个早期文件存在注释乱码，不影响编译，但影响接收方维护效率。建议逐步修复核心文件注释。
- 审计日志已经 fail-closed，但字段粒度仍可增强：actor、authType、route、IP、requestId、before/after、批量数量和结果。
- 如果未来需要接入新供应商，必须先更新 `UPSTREAM_ALLOWED_HOSTS`，再增加价格、余额同步和 smoke 用例。

## 6. 正式签收条件

1. 本地门禁和远端 CI 全绿。
2. Railway 生产环境证明只有单写实例。
3. 自动备份和恢复演练完成并归档。
4. 高危操作有审批、审计、备份和回滚记录。
5. 线上 smoke/UAT 全部通过。
6. 代码仓库、Railway、DNS、飞书应用、供应商账号、通知群、生产密钥库、备份存储的 owner 和权限交割完成，并通过 `HANDOFF-ASSET-SIGNOFF.template.json` 结构化签收。

以上任一项失败，不建议视为完成正式交接。

## 7. 2026-06-20 追加整改记录

新增非破坏性内部备份接口：

- `POST /api/internal/admin/backup`
- 仅接受 `INTERNAL_API_KEY`。
- 公网仍应由 `railway/start.mjs` 对 `/api/internal/*` 返回 404。
- 执行时会先 flush DB，再把 `data.db`、usage queue、dead-letter 复制到 `/data/backups/handoff-<timestamp>/`。
- 对复制出来的 SQLite 文件执行 `PRAGMA integrity_check`。
- 写入 `manifest.json`，记录文件大小、SHA-256、核心表数量和校验结果。
- 不返回明文 Secret、员工 Key 或供应商 Key。

本地接口级烟测已完成：使用临时 DB 副本启动生产模式 web，确认缺失 `ENCRYPTION_KEY` 会 fail-fast；补齐本地测试密钥后调用 `/api/internal/admin/backup`，返回 `success=true` 且 `verification.integrity=ok`。临时 DB 和备份文件已清理。

此整改解决“缺少可重复执行的生产备份校验入口”的代码缺口，但不等于已经完成正式灾备签收。正式交接仍必须补齐：

- 在生产内部执行一次 `/api/internal/admin/backup`，记录返回的 `backupDir`、`manifest.sha256`、`verification.integrity` 和核心表数量。
- 把备份下载到公司受控存储。
- 在临时环境恢复并验证登录、渠道、价格、usage、余额和通知。
- 将执行人、时间、源文件、恢复位置、验证结果写入变更单。

## 8. 2026-06-20 生产备份演练进展

已完成：

- 通过 `RUN_BACKUP_DRILL_ON_START=true` 在生产容器启动阶段执行一次真实 `/data` 卷内备份。
- 生成备份目录：`/data/backups/handoff-2026-06-20T02-50-12-179Z`。
- `manifest.json` 校验结果：`verification.integrity=ok`。
- 备份 DB 大小：`13545472`。
- 核心表计数：`tables=13`、`users=153`、`userApiKeys=8`、`channels=5`、`modelPrices=30`、`usageLogs=104`、`quotaReservations=0`、`alertLogs=3`。
- 演练变量 `RUN_BACKUP_DRILL_ON_START` 和 `BACKUP_DRILL_RUN_ID` 已删除。
- 已重新部署默认关闭版本：`d96ff72c-f4a1-45ec-ae18-bf4168faf442`。
- 默认关闭版本 health 正常，近 15 分钟 5xx 日志为空。

仍未完成：

- Railway 大文件下载通道在本机下载 `data.db` 和历史备份时卡住，未能完成生产 DB 下载。
- 2026-06-20 18:01 +08 再次尝试：目录 listing 和 `manifest.json` 下载成功，`data.db` 下载仍因 Railway CLI `Timeout` 失败并只留下 `2097152` bytes 残缺文件；本地残缺文件和 manifest 已删除。
- 同次尝试中，`railway ssh --service web -- ls/sha256sum ...` 未返回，已终止本地挂起进程。
- 2026-06-20 18:08 +08 追加尝试下载整个备份目录并把 `--concurrency` 降到 `1`，仍在 `data.db` 下载阶段因 Railway CLI `Timeout` 失败；本地临时目录已删除。
- 生产备份尚未落到公司受控存储。
- 尚未在临时环境完成完整恢复演练。

结论：生产卷内备份生成与 SQLite 完整性校验已完成；当前本机 Railway CLI/SSH 通道仍不能可靠搬运完整 DB。正式灾备签收仍需要接收方使用可用的云平台文件下载、对象存储备份任务或运维通道完成外部备份和恢复演练。

## 9. 2026-06-20 签收材料补充

已补充：

- `docs/HANDOFF-UAT-SIGNOFF.md`：覆盖登录权限、员工 Key、模型调用计费、渠道余额价格、飞书同步通知、灾备恢复、资产交割和签字结论。
- `scripts/verify-sqlite-backup.mjs`：接收方下载 `data.db` 后可执行只读 SQLite 校验，输出 `integrity`、SHA-256、文件大小、缺失表和核心表计数。
- `scripts/production-smoke.mjs`：接收方可执行线上非计费 smoke；如提供员工 Key，可继续验证 `/v1/models` 和授权的小额 chat。
- `scripts/handoff-uat-evidence.mjs`：接收方可生成脱敏 JSON 证据包，默认不调用模型；显式传入员工 Key 和计费参数后才执行小额调用。
- `docs/HANDOFF-ASSET-SIGNOFF.template.json`：接收方可复制后填写结构化资产交割证据；实际签收文件不要提交 Git。
- `docs/HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json`：接收方可复制后填写结构化备份恢复证据；实际签收文件不要提交 Git。
- `scripts/handoff-readiness-report.mjs`：接收方可把 UAT、备份恢复签收和资产交割证据输入脚本，输出 `formalSignoffReady` 和剩余缺口；坏 JSON 或路径错误会在 `readError` 中显示。
- `scripts/handoff-final-check.mjs`：接收方可执行正式签收强制门禁，缺任一证据时退出非 0。
- `scripts/handoff-gate.mjs` 已纳入签收表、备份校验脚本和生产 smoke 脚本存在性检查。

接收方正式签收前应把 `HANDOFF-UAT-SIGNOFF.md` 填完整，并把 `scripts/verify-sqlite-backup.mjs <downloaded-data.db>`、`pnpm smoke:production`、`pnpm handoff:uat`、员工 Key smoke、`handoff-backup-restore-signoff.json`、`handoff-asset-signoff.json` 的输出或文件归档到公司受控存储或变更单。
