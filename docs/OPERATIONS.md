# 运维手册

最后更新：2026-06-18

本文档用于线上维护、部署、环境变量、定时任务和应急操作。

## 1. 当前生产部署

当前线上运行在 Railway。

运行方式：

1. `Dockerfile` 构建 Web 和 Proxy。
2. 生产镜像启动 `node railway/start.mjs`。
3. `railway/start.mjs` 启动两个子进程：
   - `node web/server.js`，内部端口 `3000`
   - `node dist/index.js`，内部端口 `3001`
4. Railway 分配公网 `PORT`。
5. `railway/start.mjs` 根据路径转发到 Web 或 Proxy。

路由转发：

- `/health` -> Proxy
- `/v1/*` -> Proxy
- `/anthropic/*` -> Proxy
- `/api/internal/*` -> 404
- 其他路径 -> Web

## 2. 必填环境变量

生产必须配置：

| 变量 | 用途 |
| --- | --- |
| `NODE_ENV=production` | 生产模式 |
| `JWT_SECRET` | Web 登录 session 签名 |
| `ENCRYPTION_KEY` | 加密供应商 Key、员工 Key、HMAC hash |
| `INTERNAL_API_KEY` | Web 和 Proxy 内部调用 |
| `FEISHU_APP_ID` | 飞书应用 ID |
| `FEISHU_APP_SECRET` | 飞书应用 Secret |
| `FEISHU_REDIRECT_URI` | 服务端飞书回调 |
| `NEXT_PUBLIC_FEISHU_APP_ID` | 浏览器发起飞书 OAuth |
| `NEXT_PUBLIC_FEISHU_REDIRECT_URI` | 浏览器飞书回调 |
| `CORS_ALLOWED_ORIGINS` | 允许的浏览器来源 |
| `PUBLIC_PROXY_BASE_URL` | 前端展示给员工的 `/v1` 地址 |
| `ADMIN_IDS` | 飞书 open_id 管理员白名单 |
| `UPSTREAM_ALLOWED_HOSTS` | 生产允许访问的上游供应商域名白名单 |

生产必须有持久化数据目录：

- Railway 推荐：`RAILWAY_VOLUME_MOUNT_PATH=/data`
- 或：`DATABASE_URL=/data/data.db`

如果没有持久化目录，`railway/start.mjs` 会拒绝启动；生产不允许通过 `ALLOW_EPHEMERAL_DATA=true` 绕过。

### 2.1 生产环境变量分级

必填：

- `NODE_ENV=production`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `INTERNAL_API_KEY`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_REDIRECT_URI`
- `NEXT_PUBLIC_FEISHU_APP_ID`
- `NEXT_PUBLIC_FEISHU_REDIRECT_URI`
- `CORS_ALLOWED_ORIGINS`
- `PUBLIC_PROXY_BASE_URL`
- `ADMIN_IDS`
- `UPSTREAM_ALLOWED_HOSTS`
- `RAILWAY_VOLUME_MOUNT_PATH=/data` 或 `DATABASE_URL=/data/data.db`

建议显式配置：

- Docker Compose: `USAGE_QUEUE_FILE=/usage/usage-queue.jsonl`
- Docker Compose: `USAGE_DEAD_LETTER_FILE=/usage/usage-dead-letter.jsonl`
- Railway single-image: use the same variables and point them at the mounted volume, usually `/data/usage-queue.jsonl` and `/data/usage-dead-letter.jsonl`.
- `PROXY_INTERNAL_URL=http://127.0.0.1:3001`
- `MAX_REQUEST_BODY_BYTES=2097152`
- `MAX_CHAT_BODY_BYTES=2097152`
- `QUOTA_RESERVATION_TTL_SECONDS=600`
- `QUOTA_DEFAULT_OUTPUT_TOKEN_RESERVE=2000`
- `QUOTA_MAX_OUTPUT_TOKEN_RESERVE=8192`

生产禁止开启：

- `ALLOW_EPHEMERAL_DATA=true`
- `ALLOW_INSECURE_DEV_AUTH=true`
- `ALLOW_INSECURE_UPSTREAMS=true`
- `ALLOW_PRIVATE_UPSTREAMS=true`
- `ALLOW_PLAINTEXT_SECRETS_FOR_DEV=true`
- `ENABLE_DEV_LOGIN=true`
- `ENABLE_DEBUG_ENDPOINT=true`
- `ENABLE_SEED_ENDPOINT=true`
- `ENABLE_CLEANUP_ENDPOINT=true`

临时开启任何高危开关必须有审批、时间窗口、执行人、复核人和关闭后验证记录。

## 3. 密钥生成

建议：

```bash
openssl rand -hex 32
```

用于：

- `JWT_SECRET`
- `ENCRYPTION_KEY`

`INTERNAL_API_KEY` 也必须高熵，建议至少 24 字节随机值。

## 4. 构建和本地检查

常用命令：

```bash
pnpm install --frozen-lockfile
pnpm --filter web build
pnpm --filter proxy build
pnpm --filter web lint
```

如果只改文档，不需要重新部署。

## 4.1 本地开发启动

推荐 Node 22 + pnpm 11.4.0，和 Dockerfile 保持一致。

安装依赖：

```bash
pnpm install --frozen-lockfile
```

Web 环境变量：

```bash
cp web/.env.local.example web/.env.local
```

本地建议设置：

```env
AUTO_SYNC_ENABLED=false
AUTO_SYNC_ON_STARTUP=false
ENABLE_DEV_LOGIN=true
ENABLE_SEED_ENDPOINT=true
```

Proxy 环境变量：

`pnpm --filter proxy dev` 的工作目录是 `proxy/`，Proxy 不会自动读取 `web/.env.local`。需要创建 `proxy/.env` 或在 shell 环境设置：

```env
WEB_URL=http://localhost:3000
INTERNAL_API_KEY=<必须与 web/.env.local 一致>
PROXY_PORT=3001
CORS_ALLOWED_ORIGINS=http://localhost:3000
USAGE_QUEUE_FILE=../.tmp/usage-queue.jsonl
USAGE_DEAD_LETTER_FILE=../.tmp/usage-dead-letter.jsonl
```

分别启动：

```bash
pnpm --filter web dev
pnpm --filter proxy dev
```

验证：

```bash
curl http://localhost:3000/api/health
curl http://localhost:3001/health
```

本地常见坑：

- Web 读 `web/.env.local`；Proxy 读 `proxy/.env` 或 shell 环境。
- 两边 `INTERNAL_API_KEY` 必须一致。
- 本地不想触发飞书、价格、余额定时任务时，设置 `AUTO_SYNC_ENABLED=false`。
- `ENCRYPTION_KEY` 一旦用于已有数据，不要随意更换。
- sql.js 是内存 DB，写入后必须经过 `saveDb()` 或 `scheduleSave()` 落盘。
- usage queue 和 dead-letter 要放在可写路径。

## 4.2 本地测试数据

当前仓库已有交接门禁和线上 smoke 脚本：

- `pnpm test`：执行 `scripts/handoff-gate.mjs`，覆盖权限、内部接口、密钥扫描、交接脚本和文档约束。
- `pnpm smoke:production`：执行线上非计费 smoke，检查 health、危险内部接口公网屏蔽、seed/dev-login 拦截。缺员工 Key 时输出会包含 skipped checks 和 `complete=false`，不能当作业务 UAT 完成。
- `SPARKLOOM_EMPLOYEE_API_KEY=sk-emp-... pnpm smoke:production:full -- --chat-model <model>`：正式 UAT/交接 smoke，强制 `/v1/models`、非流式小额调用和流式小额调用都通过。不要把员工 Key 写入文档或聊天。
- `pnpm handoff:uat`：生成脱敏 UAT 自动证据；正式业务签收必须提供真实员工 Key，并带 `--allow-billable --chat-model <model> --include-stream`，随后填写 `docs/HANDOFF-BUSINESS-UAT-SIGNOFF.template.json`。

但当前仍没有纳入 package script 的标准业务 seed 命令。`/api/setup/seed` 只能作为本地受控入口，不是新人默认测试数据路径。

可用但受限的入口：

- `/api/auth/dev-login`：仅本地、非生产、`ENABLE_DEV_LOGIN=true`，固定以开发管理员 session 登录。
- `/api/setup/seed`：仅本地、非生产、`ENABLE_SEED_ENDPOINT=true`，且需要 admin session，会删除旧 DB 并重建模拟数据。

推荐接手团队维护一条明确测试数据路径：

- 提供一份脱敏的本地 `data.db` 测试库。
- 或补一个受控 CLI seed 脚本，生成 admin、员工 Key、渠道、模型价格、usage_logs。
- 历史辅助脚本使用前必须核对 schema 和敏感数据，不应作为新人默认入口。

## 5. 定时任务

定时任务从 `web/src/instrumentation.ts` 调用 `startAutoSync()` 启动。

配置：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AUTO_SYNC_ENABLED` | `true` | 是否启用全部定时任务 |
| `AUTO_SYNC_ON_STARTUP` | `true` | 启动后是否延迟跑初始同步 |
| `AUTO_SYNC_STARTUP_DELAY_MS` | `120000` | 启动同步延迟 |
| `BALANCE_SYNC_INTERVAL_MINUTES` | `60` | 余额自动同步间隔 |
| `BALANCE_ALERT_TIMES` | `09:30,12:00,14:30,17:30` | 余额提醒时间，北京时间 |
| `BALANCE_ALERT_NOTIFY_ENABLED` | `true` | 是否发送余额不足飞书提醒 |
| `FEISHU_MAX_AUTO_DISABLE_DEPARTED` | `5` | 单次自动停用离职候选上限 |

固定调度：

- 飞书通讯录同步：北京时间 12:00、19:00。
- 模型价格同步：北京时间 03:00。
- 余额同步：默认每小时。
- 余额提醒：默认 09:30、12:00、14:30、17:30。
- 异常用量检测：每小时。
- 员工状态检查：北京时间 20:00。
- 排行榜：每天 10:00 检查是否应发送。

## 6. 健康检查

公网健康：

```bash
curl https://ai.seapllo.com/health
```

返回 `ok` 或 `degraded`。

详细健康只能内部带 `INTERNAL_API_KEY` 查看：

```bash
curl -H "Authorization: Bearer $INTERNAL_API_KEY" http://127.0.0.1:3000/api/health
curl -H "Authorization: Bearer $INTERNAL_API_KEY" http://127.0.0.1:3001/health
```

Web 详细健康包括：

- JWT 是否配置。
- INTERNAL_API_KEY 是否配置。
- ENCRYPTION_KEY 是否配置。
- 飞书是否配置。
- DB 可读。
- DB 可写。
- 关键表是否存在。
- 用户状态分布。

Proxy 详细健康包括：

- Web URL。
- Internal Key 是否配置。
- Web 健康。
- usage 持久队列状态。

## 7. 常用手动任务

飞书同步：

```bash
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"background":true}' \
  http://127.0.0.1:3000/api/internal/admin/sync-feishu
```

价格同步：

```bash
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  http://127.0.0.1:3000/api/internal/admin/prices/sync
```

余额同步：

```bash
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"notify":false}' \
  http://127.0.0.1:3000/api/internal/admin/channels/balance-sync
```

发送余额提醒时把 `notify` 改为 `true`。

非破坏性备份并校验：

```bash
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  http://127.0.0.1:3000/api/internal/admin/backup
```

执行后检查返回的 `verification.integrity` 必须为 `ok`，并把 `backupDir`、`manifest.sha256`、核心表数量记录到变更单。生产 Railway 建议启用 `BACKUP_OBJECT_STORAGE_ENABLED=true`，并配置 R2/S3-compatible 变量：`BACKUP_S3_ENDPOINT`、`BACKUP_S3_REGION`、`BACKUP_S3_BUCKET`、`BACKUP_S3_ACCESS_KEY_ID`、`BACKUP_S3_SECRET_ACCESS_KEY`、`BACKUP_S3_PREFIX`。启用后响应必须包含 `objectStorage.backupPrefix`，该前缀下应有 `data.db`、`manifest.json`、`usage-queue.jsonl`、`usage-dead-letter.jsonl` 四个对象。正式灾备应从对象存储下载完整前缀到公司受控目录，执行 `node scripts/verify-sqlite-backup.mjs <backup-dir>`，确认 `inputType=backup-directory`、`manifestMatches=true`，并做恢复演练；交接签收时应复制 `docs/HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json`，填写 `handoff-backup-restore-signoff.json` 并归档。

如果 Railway SSH 不可用，可使用一次性启动演练：

1. 设置 `RUN_BACKUP_DRILL_ON_START=true`。
2. 设置唯一的 `BACKUP_DRILL_RUN_ID`，建议使用 `YYYYMMDD-HHMM-operator`。
3. 部署一次。
4. 在 deployment logs 中查找 `[BackupDrill] completed ...`。
5. 记录 `backupDir`、`manifestSha256`、`dataDbSha256`、`dataDbSize`、`verification.integrity` 和核心表数量。
6. 立刻删除 `RUN_BACKUP_DRILL_ON_START` 或改回 `false` 并重新部署。

该方式只在应用启动时生成并校验备份，不开放公网下载数据库；如果对象存储变量已启用，也会上传完整备份四件套。正式签收仍必须从对象存储下载到公司受控存储后做恢复演练。

## 8. 数据文件

数据库路径优先级：

1. `DATABASE_URL` 是本地路径时使用该路径。
2. `RAILWAY_VOLUME_MOUNT_PATH` 存在时使用 `${RAILWAY_VOLUME_MOUNT_PATH}/data.db`。
3. 否则使用 `./data.db`。

Proxy usage 队列：

- `USAGE_QUEUE_FILE`，Docker Compose 默认 `/usage/usage-queue.jsonl`；Railway 单镜像通常配置为 `/data/usage-queue.jsonl`
- `USAGE_DEAD_LETTER_FILE`，Docker Compose 默认 `/usage/usage-dead-letter.jsonl`；Railway 单镜像通常配置为 `/data/usage-dead-letter.jsonl`

这两个文件也必须在持久卷里。

## 9. 重启前注意事项

重启会触发：

- Web 加载 sql.js DB 到内存。
- `ensureAllTables()` 检查和补齐表结构。
- Proxy 读取持久 usage 队列。
- 如果开启启动同步，延迟后触发飞书、价格、余额等同步。

重启前建议：

- 确认没有长时间大流量压测。
- 确认 `/data` 可写。
- 确认环境变量完整。
- 备份 `data.db`。

## 10. 应急开关

关闭所有定时任务：

```env
AUTO_SYNC_ENABLED=false
```

关闭启动同步：

```env
AUTO_SYNC_ON_STARTUP=false
```

关闭余额提醒但保留余额同步：

```env
BALANCE_ALERT_NOTIFY_ENABLED=false
```

临时禁用某个渠道：

- 后台渠道管理把状态改为 `disabled`。
- 禁用渠道不会被 Proxy 调用。
- 禁用渠道不会触发余额告警。

## 11. 飞书应用维护

飞书开放平台需要配置：

- 重定向 URL：`https://ai.seapllo.com/api/auth/feishu/callback`
- 应用可用范围：全员或目标部门。
- 通讯录权限：读取部门、读取用户。
- 身份认证权限：OAuth 登录、读取用户基本信息。
- 消息权限：机器人发送消息、获取机器人所在群列表。

如果轮换飞书应用凭证：

1. 在飞书开放平台生成新 Secret。
2. 更新 Railway 环境变量。
3. 重新部署。
4. 测试登录。
5. 测试通讯录同步。
6. 测试飞书私聊和群消息。

## 12. Railway 发布和回滚

发布前：

- 备份 `data.db`。
- 记录当前 Git commit。
- 记录 Railway 当前 deployment。
- 导出或截图环境变量状态，敏感值必须脱敏。
- 执行 `RELEASE-CHECKLIST.md`。

代码回滚：

1. 优先在 Railway 控制台 redeploy 上一个成功 deployment。
2. 如果需要从 Git 回滚，使用 revert commit 后重新部署。
3. 不要在不清楚数据变更的情况下直接切旧代码长时间运行。

环境变量回滚：

- 只回滚本次变更的变量。
- 必须对照发布前变量快照。
- `ENCRYPTION_KEY`、`INTERNAL_API_KEY`、`JWT_SECRET` 不得随意回滚或轮换。

数据回滚：

- 只在确认数据损坏时执行。
- 恢复前停止写流量。
- 成套恢复 `data.db`、`usage-queue.jsonl`、`usage-dead-letter.jsonl`。
- 不要混用不同时间点的 DB 和 queue。

回滚后必须验证：

- `https://ai.seapllo.com/health`
- 内部 `/api/health`
- 管理员飞书登录
- `/v1/models`
- 一次小流量 chat 调用并确认 usage 入库
- Railway 日志 10 分钟内无 `[railway] exited`、`[Usage] Flush error`、`[FeishuBot] Failed`
