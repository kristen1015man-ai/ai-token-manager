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

生产必须有持久化数据目录：

- Railway 推荐：`RAILWAY_VOLUME_MOUNT_PATH=/data`
- 或：`DATABASE_URL=/data/data.db`

如果没有持久化目录，`railway/start.mjs` 会拒绝启动，除非显式设置 `ALLOW_EPHEMERAL_DATA=true`。生产禁止使用临时数据。

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
  http://127.0.0.1:3000/api/setup/sync-feishu
```

价格同步：

```bash
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  http://127.0.0.1:3000/api/admin/prices/sync
```

余额同步：

```bash
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"notify":false}' \
  http://127.0.0.1:3000/api/admin/channels/balance-sync
```

发送余额提醒时把 `notify` 改为 `true`。

## 8. 数据文件

数据库路径优先级：

1. `DATABASE_URL` 是本地路径时使用该路径。
2. `RAILWAY_VOLUME_MOUNT_PATH` 存在时使用 `${RAILWAY_VOLUME_MOUNT_PATH}/data.db`。
3. 否则使用 `./data.db`。

Proxy usage 队列：

- `USAGE_QUEUE_FILE`，默认 `/data/usage-queue.jsonl`
- `USAGE_DEAD_LETTER_FILE`，默认 `/data/usage-dead-letter.jsonl`

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
