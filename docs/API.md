# API 契约

最后更新：2026-06-18

本文档列出当前代码中的主要 API。除 `/v1/*`、`/anthropic/*`、`/health` 和认证入口外，业务 API 默认需要 Web session。

## 1. 公开模型 API

### GET `/v1/models`

认证：

- `Authorization: Bearer sk-emp-...`
- 或 `x-api-key: sk-emp-...`

行为：

- Proxy 调 Web 内部接口加载启用渠道和可用模型。
- 返回 OpenAI 兼容模型列表。
- 只返回启用渠道中且有价格的模型。

### POST `/v1/chat/completions`

认证：

- `Authorization: Bearer sk-emp-...`
- 或 `x-api-key: sk-emp-...`

请求：

- OpenAI 兼容 chat completions JSON。
- 必填：`model`
- 可选：`stream`

行为：

1. 鉴权员工 Key。
2. 查找支持该模型的启用渠道。
3. 做限额预占。
4. 转发到上游 `/v1/chat/completions`。
5. 记录 usage。
6. 主渠道失败时尝试 fallback 渠道。

状态码：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 无效或缺 model |
| 401 | Key 缺失、格式错误、无效或用户禁用 |
| 404 | 没有可用渠道 |
| 413 | 请求体过大 |
| 422 | 模型缺价 |
| 429 | 限额超限 |
| 502 | 上游失败 |

### POST `/anthropic/v1/messages`

认证同 `/v1/chat/completions`。

行为：

- Anthropic Messages 兼容入口。
- 由 `proxy/src/routes/anthropic.ts` 和 `proxy/src/services/anthropic.ts` 处理。

### POST `/anthropic/v1/messages/count_tokens`

认证同上。

行为：

- 本地估算并返回 `input_tokens`；不调用上游供应商，避免未计费的 provider key 消耗。
- 用于 Claude Code 等客户端。

## 2. 健康检查

### GET `/health`

公网访问时返回简要状态。

详细状态需要内部 Bearer：

```http
Authorization: Bearer ${INTERNAL_API_KEY}
```

### GET `/api/health`

Web 健康检查。

公网访问只返回简要状态；内部 Bearer 返回详细 checks。

## 3. 认证 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/feishu/start` | 生成 OAuth state 并跳转飞书 |
| GET | `/api/auth/feishu/callback` | 飞书 OAuth 回调，创建 session |
| GET | `/api/auth/me` | 返回当前 session 用户 |
| POST | `/api/auth/logout` | 清除 session |
| GET | `/api/auth/dev-login` | 开发登录，生产不可依赖 |

## 4. 用户 API

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/user/key` | 登录用户 | 返回自己的 Key 列表，只有脱敏值 |
| POST | `/api/user/key` | 登录用户 | 新建 Key，明文只在本次响应返回 |
| DELETE | `/api/user/key` | 登录用户 | 删除自己的 Key，至少保留一个 |
| GET | `/api/usage/summary` | 登录用户 | 个人用量概览 |
| GET | `/api/usage/chart` | 登录用户 | 个人图表数据 |
| GET | `/api/usage/details` | 登录用户 | 个人明细 |
| GET | `/api/usage/by-model` | 登录用户 | 个人按模型统计 |

## 5. 管理 API

管理 API 路径统一为 `/api/admin/*`。middleware 只校验登录态，route handler 必须做角色校验。

### 概览和统计

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/admin/overview` | admin, finance | 全局概览 |
| GET | `/api/admin/departments` | admin, finance, dept_manager | 部门排行 |
| GET | `/api/admin/employees` | admin, dept_manager | 员工排行 |
| GET | `/api/admin/org-structure` | admin | 组织架构树、异常归属人员、层级统计 |
| GET | `/api/admin/billing/by-channel` | admin, finance, dept_manager | 按渠道分账 |
| GET | `/api/admin/billing/by-model` | admin, finance, dept_manager | 按模型分账 |
| GET | `/api/admin/export` | admin, finance, dept_manager | 导出数据，dept_manager 只导出本部门范围 |

### 渠道

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/admin/channels` | admin | 渠道列表 |
| POST | `/api/admin/channels` | admin | 新增渠道 |
| PUT | `/api/admin/channels` | admin | 更新渠道 |
| DELETE | `/api/admin/channels` | admin | 删除渠道 |
| POST | `/api/admin/channels/balance-sync` | admin | 手动余额同步 |

### 模型价格

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/admin/prices` | admin | 价格列表 |
| POST | `/api/admin/prices` | admin | 新增价格 |
| PUT | `/api/admin/prices` | admin | 更新价格 |
| DELETE | `/api/admin/prices` | admin | 删除价格并写黑名单 |
| POST | `/api/admin/prices/sync` | admin | 手动官方价格同步 |
| GET | `/api/admin/models` | admin | 模型列表 |
| GET/POST | `/api/admin/exchange-rate` | admin | 汇率读取/刷新 |

### 权限、额度、日志

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| GET/POST | `/api/admin/quotas` | admin | 限额读取、单个或批量更新 |
| GET/POST/DELETE/PUT | `/api/admin/permissions` | admin | 角色读取、添加、移除、兼容式覆盖 |
| GET/DELETE | `/api/admin/user-keys` | admin | 查询员工 Key 脱敏列表、应急吊销员工 Key |
| GET/PATCH | `/api/admin/users/status` | admin | 查询用户状态、恢复或停用用户 |
| GET | `/api/admin/admins-list` | admin | 管理员选择列表 |
| GET | `/api/admin/logs` | admin | 管理日志 |
| GET | `/api/admin/audit-logs` | admin | 审计日志 |

### 飞书和预警

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/admin/alerts` | admin | 预警记录 |
| GET/PUT | `/api/admin/alerts/settings` | admin | 预警配置 |
| POST | `/api/admin/alerts/test-feishu` | admin | 测试飞书通知 |
| POST | `/api/admin/alerts/test-anomaly` | admin | 测试异常预警 |
| POST | `/api/admin/anomaly-check` | admin | 手动异常检测 |
| POST | `/api/admin/employee-status-check` | admin | 手动员工状态检查 |
| GET | `/api/admin/feishu/chats` | admin | 机器人所在群列表 |
| POST | `/api/admin/leaderboard-send` | admin | 手动发送排行榜 |

自动任务不再调用公网管理路径。所有使用 `INTERNAL_API_KEY` 的任务入口统一收敛到 `/api/internal/*`。

### 清理和迁移

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/admin/cleanup-preview` | admin | 清理预览 |
| POST | `/api/admin/cleanup-execute` | admin | 非生产清理执行；生产环境固定返回 404 |
| POST | `/api/admin/migrate/encrypt` | admin | 旧密钥加密迁移 |
| GET | `/api/admin/debug` | admin | 调试信息 |

## 6. 飞书同步 API

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/setup/sync-feishu` | admin | 查看同步状态 |
| POST | `/api/setup/sync-feishu` | admin | 手动执行同步 |
| POST | `/api/setup/seed` | 受保护 | 初始化模拟数据，生产慎用 |

POST body：

```json
{ "background": true }
```

`background=true` 时后台运行，同一时刻只允许一个同步任务。

## 7. 内部 API

内部 API 必须带：

```http
Authorization: Bearer ${INTERNAL_API_KEY}
```

| 方法 | 路径 | 调用方 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/internal/proxy/authenticate` | Proxy | 校验员工 Key |
| GET | `/api/internal/proxy/channels?model=...` | Proxy | 返回启用渠道和解密后的上游 Key |
| POST | `/api/internal/proxy/quota/check` | Proxy | 请求前限额检查和预占 |
| POST | `/api/internal/proxy/quota/release` | Proxy | 上游失败时释放预占 |
| POST | `/api/internal/usage` | Proxy | usage 批量落库 |
| POST | `/api/internal/quota-alert` | Web/internal | 额度预警 |
| POST | `/api/internal/admin/migrate/encrypt` | internal + maintenance | 幂等加密迁移旧敏感字段，修复历史明文 `users.api_key`、渠道密钥字段；除 `INTERNAL_API_KEY` 外，还要求 `x-sparkloom-maintenance-confirm: encrypt-sensitive-fields` |
| POST | `/api/internal/admin/reset-billing` | internal + maintenance | 重置计费数据；除 `INTERNAL_API_KEY` 外，还要求 `ENABLE_INTERNAL_BILLING_RESET=true` 和 `x-sparkloom-maintenance-confirm: reset-billing-usage` |
| POST | `/api/internal/admin/flush-db` | internal | 强制 DB 落盘 |
| POST | `/api/internal/admin/backup` | internal | 生成非破坏性备份并校验 SQLite integrity |
| GET/POST | `/api/internal/admin/sync-feishu` | Web auto-sync | 飞书通讯录同步 |
| POST | `/api/internal/admin/prices/sync` | Web auto-sync | 官方价格同步 |
| POST | `/api/internal/admin/channels/balance-sync` | Web auto-sync | 渠道余额同步 |
| POST | `/api/internal/admin/anomaly-check` | Web auto-sync | 异常检测 |
| POST | `/api/internal/admin/employee-status-check` | Web auto-sync | 员工状态检查 |
| POST | `/api/internal/admin/leaderboard-send` | Web auto-sync | 排行榜发送 |

公网访问 `/api/internal/*` 会被 `railway/start.mjs` 返回 404。

Proxy 内部管理接口：

| 方法 | 路径 | 调用方 | 说明 |
| --- | --- | --- | --- |
| POST | `/internal/admin/usage-queue/clear` | Web/internal + maintenance | 清空 Proxy 内存 usage queue，并重写空持久队列文件；要求 `ENABLE_PROXY_USAGE_QUEUE_CLEAR=true` 和 `x-sparkloom-maintenance-confirm: reset-billing-usage` |

## 8. 已禁用旧代理 API

| 方法 | 路径 | 状态 |
| --- | --- | --- |
| GET | `/api/proxy/v1/models` | 410 |
| POST | `/api/proxy/v1/chat/completions` | 410 |

客户端必须使用：

- `https://ai.seapllo.com/v1`
- `https://ai.seapllo.com/anthropic`
