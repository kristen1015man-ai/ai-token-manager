# 接收方交接审查退回清单

最后更新：2026-06-19

本文档用于交接前严格签收。口径按“接收方需要重金购买项目”的标准执行，不只看功能是否可用，还看资金安全、密钥安全、权限边界、发布证据和后续维护可接手性。

## 1. 本轮本地验证结果

已通过：

- `pnpm install --frozen-lockfile`
- `pnpm test`
- `pnpm --filter web lint`
- `pnpm --filter web build`
- `pnpm --filter proxy build`
- `pnpm --filter shared db:migrate`，使用临时 DB 烟测
- `pnpm audit --prod --registry=https://registry.npmjs.org`
- `git diff --check`，无格式错误，仅 Windows CRLF 提示
- 阻断关键字扫描：固定员工 key、公开 admin internal 绕过、废弃 `ADMIN_` + `EMAILS`、`INTERNAL_API_` + `ALLOWED_PATHS` 均无命中

## 2. 本轮已修复

- 公网 admin/setup 路由不再接受 `INTERNAL_API_KEY`，只接受管理员 session。
- 定时任务改走 `/api/internal/admin/*` 内部路由。
- `web/src/proxy.ts` 内部 Bearer 比较改为固定时间比较。
- Hono proxy 渠道接口在渠道 key 解密失败时排除该渠道，避免把 `enc:v1:*` 密文样式值转发给上游。
- 旧 Next 代理缓存分支同样增加不可解密渠道排除。
- `docker-compose.yml` 注释改为当前架构：web 是唯一 DB owner，proxy 只持久化 usage 队列。
- `auditLog()` 已改为 fail-closed，写入失败会抛错，不再静默吞掉。
- `/api/admin/cleanup-execute` 已改为生产环境不可开启，只允许非生产且显式设置 `ENABLE_CLEANUP_ENDPOINT=true`。
- `/api/health` 已增加 encrypted secret 抽样解密检查；解密失败时 health 进入 degraded。
- 新增 CI 工作流与 handoff gate。
- 新增 checked-in DB migration runner。

## 3. 签收结论

当前代码已清掉本轮可复现的 P0/P1 代码阻断，但仍不建议无条件正式签收。

可以进入真实数据 UAT。正式交接签字前，接收方仍需要拿到生产平台证据、备份恢复证据、线上 smoke/UAT 证据和资产交割记录。这些不是代码能单方面证明的内容。

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

- `reset-billing` 必须有演练记录、前置备份、操作审批和回滚步骤。
- cleanup 如果后续确需生产使用，应改为一次性脚本或短期签名 token，不应恢复为常驻公网 API。

### 4.4 线上健康检查和 smoke 证据

证据文件：

- `web/src/app/api/health/route.ts`
- `proxy/src/index.ts`
- `docs/RELEASE-CHECKLIST.md`

现状：

- 本地构建和门禁通过。
- health 已能检查必填 env、DB 表、DB 可写、encrypted secret 抽样解密。
- 仍缺少当前线上环境的执行记录。

签收要求：

- 提供线上 `/api/health` 详细输出，敏感值必须脱敏。
- 提供线上 `/health` 输出。
- 提供登录、`/v1/models`、小额 chat、usage 入库、余额同步、飞书通知的 smoke 记录。

### 4.5 远端 CI 和最终发布证据

证据文件：

- `.github/workflows/ci.yml`
- `docs/RELEASE-CHECKLIST.md`

现状：

- CI workflow 已加入。
- 当前工作区仍有未提交改动。
- 本地绿色不能替代远端 CI 和生产 deployment 记录。

签收要求：

- 提供最终 commit、tag 或 release 编号。
- 提供远端 CI 绿色截图或日志。
- 提供 Railway deployment 编号、构建日志、回滚入口。

### 4.6 上游 URL SSRF 残余风险

证据文件：

- `proxy/src/services/upstream-safety.ts`
- `web/src/lib/upstream-safety.ts`

现状：

- 代码会校验协议、禁止本地/metadata host、解析 DNS 并阻止私网地址。
- 校验后实际 `fetch()` 仍由运行时重新解析域名，理论上仍存在 DNS rebinding/TOCTOU 残余风险。

签收要求：

- 生产建议限制供应商 base URL 到 allowlist，如 DeepSeek、SiliconFlow、OpenAI、Anthropic、GLM。
- 或实现 DNS pinning/固定 IP 出口校验。

## 5. P2 建议整理

- 根目录 `seed.ts`、`seed-mock.ts` 仍是旧开发脚本，包含占位供应商 key 和明文 seed 逻辑。建议移到 `scripts/dev-only` 并加明显保护，或从正式交接包移除。
- 多个早期文件存在注释乱码，不影响编译，但影响接收方维护效率。建议逐步修复核心文件注释。
- `proxy/src/services/usage.ts` 仍有 `if (false)` 死代码，建议清理。
- 审计日志已经 fail-closed，但字段粒度仍可增强：actor、authType、route、IP、requestId、before/after、批量数量和结果。

## 6. 正式签收条件

1. 本地门禁和远端 CI 全绿。
2. Railway 生产环境证明只有单写实例。
3. 自动备份和恢复演练完成并归档。
4. 高危操作有审批、审计、备份和回滚记录。
5. 线上 smoke/UAT 全部通过。
6. 飞书、Railway、DNS、供应商账号、通知群、备份存储的 owner 和权限交割完成。

以上任一项失败，不建议视为完成正式交接。
