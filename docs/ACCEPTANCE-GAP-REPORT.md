# 接收方交接审查退回清单

最后更新：2026-06-19

本文档按接收方项目经理、后端架构、安全资金审计、SRE 运维、QA 测试、一线支持/业务管理员六个岗位进行只读审查后汇总。结论：当前资料和代码已经具备接手基础，但不满足正式签收标准。乙方需要先补齐 P0 项，再进入正式验收。

## 1. 本轮本地验证结果

通过项：

- `pnpm install --frozen-lockfile`
- `pnpm --filter web lint`
- `pnpm --filter proxy build`
- `node --check railway/start.mjs`
- `git -c core.excludesfile= status --short` 为空

未通过或无证据项：

- `pnpm --filter web build` 失败：清理 `web/.next` 时出现 `EPERM: operation not permitted, unlink ...`。该结果不能作为构建通过证据。
- 未发现已跟踪的 `*.test.*`、`*.spec.*`、`playwright.config.*`、`vitest.config.*`、`jest.config.*` 或 `.github/workflows/*`。
- `package.json`、`web/package.json`、`proxy/package.json` 均无正式 `test` 脚本。

## 2. P0 阻断验收项

### 2.1 限额预占可被单次大请求打穿

证据：

- `web/src/app/api/internal/proxy/quota/check/route.ts`

问题：

- 当前只判断 `used + reserved >= limit`。
- 没有判断 `used + reserved + estimatedCost > limit`。
- 之后还把 `reservationCost` 截断为 `remaining`，余额不足时仍可能放行高成本请求。
- 个人、部门、公司三层额度都受影响。

要求乙方处理：

- 任一层级 `used + reserved + estimatedCost > limit` 必须返回 429。
- 预占金额必须为完整 `estimatedCost`，不能截断后放行。
- 补个人、部门、公司、并发、stream/non-stream 回归用例。
- 增加单请求最大 token 或最大预计金额限制。
- 对实际费用超过预估的情况增加事后告警。

### 2.2 生产 DB 单写约束和发布双写风险无证据

证据：

- `web/src/lib/db.ts`
- `docs/HANDOVER.md`

问题：

- 当前为 sql.js 内存库，整库导出写文件。
- 多实例、滚动发布或重启期间如果出现两个 Web 进程同时写同一 volume，存在数据覆盖风险。

要求乙方处理：

- 提供 Railway 当前 `replica=1`、不会滚动双写同一 volume 的平台证据。
- 给出发布/回滚前停止写流量方案。
- 如不能证明单写，迁移 PostgreSQL，或引入外部事务存储/单写锁。

### 2.3 自动备份和恢复演练缺少可归档证据

证据：

- `docs/backup-restore.md`
- `docs/HANDOVER.md`

问题：

- 文档只有要求，没有可运行自动备份实现、外部受控存储位置、最近备份日志和恢复演练记录。
- 本地 `backups/` 不能作为生产备份证据。

要求乙方处理：

- 交付独立于应用进程的自动备份任务。
- 提供外部受控存储位置和访问控制说明。
- 提供最近一次备份日志和恢复演练记录。
- 恢复演练必须覆盖 `data.db`、`usage-queue.jsonl`、`usage-dead-letter.jsonl` 同时间点恢复。

### 2.4 缺正式自动化测试套件

证据：

- `package.json`
- `web/package.json`
- `proxy/package.json`

问题：

- 没有 `test`/`e2e` 脚本。
- 没有已跟踪测试文件或 CI。
- 高风险链路目前依赖人工 checklist。

要求乙方处理：

- 增加 `pnpm test` 和 CI 阻断。
- 至少覆盖 API Key 明文/脱敏、权限 403、内部 API 隔离、渠道密钥校验、计费 usage、限额 429、queue/dead-letter、流式 usage、飞书同步保护。
- 提供干净环境构建和测试日志。

### 2.5 交接验收、UAT、资产交割缺少证据

证据：

- `docs/HANDOVER.md`
- `docs/RELEASE-CHECKLIST.md`

问题：

- 文档列了交接验收清单，但没有逐项 Pass/Fail、截图、时间、执行人、验收人。
- 没有最近一次上线 smoke/UAT 记录。
- 没有 Railway、飞书开放平台、DNS、供应商账号、通知群、备份存储的交割状态。

要求乙方处理：

- 按交接验收清单逐项提供证据。
- 提供最近一次发布的 commit、Railway deployment、构建日志、health 输出、登录、`/v1/models`、小额 chat、usage 入库截图或日志。
- 提供外部资产 Owner、备份 Owner、权限级别、交接状态、应急联系人和找回方式。

### 2.6 员工 Key 泄露和误停用恢复缺少后台闭环

证据：

- `docs/INCIDENT-RUNBOOK.md`
- `docs/SUPPORT-RUNBOOK.md`
- `web/src/app/api/user/key/route.ts`
- `web/src/app/api/admin/employees/route.ts`

问题：

- 事故手册要求删除泄露员工 Key，但当前只看到员工自助 Key 接口，没有管理员按用户/末四位定位并吊销 Key 的入口。
- 文档写可临时恢复误停用用户为 `active`，但未看到业务管理员可用的恢复入口。

要求乙方处理：

- 增加管理员 Key 应急台账/API/页面，支持按用户、末四位、创建时间、last_used_at 定位并吊销。
- 关键操作写入 `admin_logs`。
- 增加 disabled 用户查询、恢复、原因记录、双人确认和回滚验证流程。

## 3. P1 必须补充或修复项

### 3.1 RBAC 管理员来源不一致

证据：

- `web/src/app/api/setup/sync-feishu/constants.ts`
- `web/src/app/api/setup/sync-feishu/normalize.ts`
- `web/src/app/api/setup/sync-feishu/execute-sync.ts`
- `.env.example`
- `docker-compose.yml`

问题：

- 代码中存在硬编码飞书 open_id 管理员。
- 模板和 compose 暴露 `ADMIN_EMAILS`，但代码实际读取 `ADMIN_IDS`。
- 撤权只处理单一 `admin`，复合角色存在撤权不彻底风险。

要求乙方处理：

- 移除源代码硬编码管理员，或正式登记并审计。
- 统一使用 `ADMIN_IDS`，删除误导的 `ADMIN_EMAILS`。
- 角色按集合解析，完整移除 `admin`。
- 飞书同步输出权限 diff 并写审计。

### 3.2 公网路径上存在高权限 internal token 入口

证据：

- `web/src/proxy.ts`
- `web/src/app/api/setup/sync-feishu/route.ts`
- `web/src/app/api/admin/prices/sync/route.ts`
- `web/src/app/api/admin/channels/balance-sync/route.ts`
- `web/src/app/api/admin/employee-status-check/route.ts`

问题：

- `/api/internal/*` 被入口层 404 保护。
- 但部分 `admin 或 internal` 接口仍在公网路径，只要持有 `INTERNAL_API_KEY` 就可触发飞书同步、价格同步、余额同步、员工状态检查等高风险动作。

要求乙方处理：

- 自动任务接口迁移到 `/api/internal/*`。
- 或增加 IP allowlist/mTLS/最小权限 token。
- 所有 internal key 比较统一使用 timing-safe helper。
- 提供轮换和访问日志。

### 3.3 审计日志覆盖不足

证据：

- `docs/SECURITY-PERMISSIONS.md`
- `web/src/lib/audit-log.ts`
- 价格、价格同步、余额同步、预警设置、cleanup、reset-billing 相关 route

问题：

- 资金、价格、余额、权限、清理、重置等关键操作无法完整追溯。
- `auditLog()` 写入失败只打印错误。

要求乙方处理：

- 关键写操作必须记录 actor、authType、接口、IP、requestId、before/after、批量数量、审批单号。
- 对价格、额度、余额、账单重置等操作，审计失败应 fail-closed，或写入外部不可篡改日志。

### 3.4 usage queue/dead-letter 永久错误会重复重试

证据：

- `proxy/src/services/usage.ts`
- `web/src/app/api/internal/usage/route.ts`

问题：

- Web 拒绝 usage 后，Proxy 写 dead-letter，同时保留同一批记录继续重试。
- 永久性坏数据可能无限重试、重复写死信、导致磁盘增长和 health pending 持续异常。

要求乙方处理：

- 增加 retry count、backoff、quarantine。
- 死信只写一次或带唯一 id 去重。
- 提供人工修复后 replay 流程和告警。

### 3.5 计费重置不清 Proxy 内存队列

证据：

- `web/src/app/api/internal/admin/reset-billing/route.ts`
- `proxy/src/services/usage.ts`

问题：

- 重置计费删除 DB 表和队列文件，但不会清空 Proxy 内存 `pendingRecords`。
- 重置后旧 usage 可能再次 flush 回 DB。

要求乙方处理：

- 提供原子重置流程：停 Proxy、flush、清内存、删文件、删 DB。
- 或增加内部 drain/clear queue API。
- 写入运维手册并演练。

### 3.6 `sync_blacklist` schema 与全局黑名单口径冲突

证据：

- `web/src/lib/ensure-tables.ts`
- `shared/migrate.ts`
- `web/src/app/api/admin/prices/route.ts`

问题：

- 文档和代码口径使用 `channel_id = null` 表示全局黑名单。
- 表定义为 `PRIMARY KEY (model, channel_id) WITHOUT ROWID`，SQLite 主键列不可为 null，可能导致插入失败或黑名单失效。

要求乙方处理：

- 重做黑名单 schema，例如 sentinel 值或 rowid 表加唯一索引。
- 补迁移。
- 补“删除全局价格后不会被同步恢复”的验收用例。

### 3.7 Railway/Docker/健康检查配置不可验证

证据：

- `railway/start.mjs`
- `Dockerfile`
- `docker-compose.yml`
- `nginx/nginx.conf`
- `web/src/app/api/health/route.ts`
- `proxy/src/services/usage.ts`

问题：

- 仓库无 Railway service 配置导出。
- Web health 的 DB 可写检查主要验证 TEMP 表，不等于持久文件成功落盘。
- Proxy queue health 只暴露路径和 pending，不充分验证 queue/dead-letter 可写性。
- Nginx 参考配置没有 `/anthropic/*` 转发。
- compose 的 DB/queue volume 注释和实际配置容易误导。

要求乙方处理：

- 提供 Railway service 配置或截图：root Dockerfile、healthcheck path、volume mount、replica、restart/deploy 策略、环境变量脱敏快照。
- health 增加真实持久卷写入、queue/dead-letter 可写性、last save/flush error。
- 修正 compose/nginx，或明确标注 compose 不是生产接管方案。

### 3.8 飞书同步、部门映射、429 诊断缺少管理入口

证据：

- `web/src/app/api/setup/sync-feishu/route.ts`
- `web/src/app/api/setup/sync-feishu/constants.ts`
- `web/src/app/api/internal/proxy/quota/check/route.ts`

问题：

- 有飞书同步 API，但未看到完整后台同步页。
- 部门映射硬编码，业务管理员无法独立维护。
- 429 争议需要查 `quota_reservations`，但后台缺可见诊断。

要求乙方处理：

- 增加飞书同步管理页，展示 running、result、failedDepartments、departedCandidates、skippedDeparted。
- 提供完整部门映射表、业务确认人、变更审批模板；建议后台配置并审计。
- 增加额度诊断页/API，展示 used、reserved、个人/部门/公司 limit、最近 reservation、429 原因和过期时间。

## 4. P2 整理项

- 根 `Product-Spec.md`、`DEV-PLAN.md`、`DEV-PLAN-token-manager.md`、`ai-token-manager.md` 存在旧项目或过期口径，应标记废弃或移出正式交接包。
- `shared` 包暴露 `db:generate`/`db:migrate`，但依赖和正式迁移口径不完整，应删除误导脚本或补齐正式迁移流程。
- `package.json` 建议声明 `packageManager` 和 `engines`，固化 Node 22、pnpm 11.4.0。
- 价格接口允许输入/输出价为 0，建议输入/输出价必须 `> 0`，缓存价可 `>= 0`。
- `/anthropic/v1/messages/count_tokens` 鉴权限频但不计费，需明确免费、单独限频或纳入计费。
- 排行榜失败原因应在页面展示 `skippedReason`、目标群和最近发送结果。
- 用户手册中客户端配置说明有重复，建议合并为一处标准配置和最小验证请求。

## 5. 建议乙方交付顺序

1. 修复 P0 限额预占漏洞。
2. 提供生产单写、备份恢复、资产交割、UAT/smoke 证据。
3. 增加最小自动化测试和 CI。
4. 增加管理员 Key 吊销、误停用恢复、额度诊断入口。
5. 修复 RBAC 管理员来源、internal 公网入口、审计覆盖。
6. 修复 usage queue/dead-letter、reset-billing、sync_blacklist。
7. 整理 Docker/compose/nginx/Railway/旧文档口径。

P0 未完成前，不建议接收方签署正式交接验收。
