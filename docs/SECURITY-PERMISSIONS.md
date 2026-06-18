# 安全与权限规范

最后更新：2026-06-18

本文档描述 Sparkloom 的安全边界。涉及资金、供应商密钥、员工 API Key、权限和内部接口的改动，必须按本文档复核。

## 1. 角色模型

角色保存在 `users.role`，多个角色用逗号分隔。解析逻辑在 `web/src/lib/permissions.ts`。

| 角色 | 页面权限 | 数据范围 | 写权限 |
| --- | --- | --- | --- |
| `admin` | 全部后台页面 | 全局 | 全部管理写操作 |
| `finance` | 全局概览、部门分账、个人用量、API Key | 全局财务只读 | 不允许改渠道、模型价格、权限、额度 |
| `dept_manager` | 部门排行、员工排行、部门分账、个人用量、API Key | 本部门 | 只读 |
| `member` | 个人用量、API Key | 本人 | 仅管理自己的 Key |

实现位置：

- 菜单和页面访问矩阵：`web/src/lib/permissions.ts`
- 页面级守卫：`web/src/proxy.ts`
- API 级守卫：`web/src/lib/admin-check.ts`

维护要求：

- 新增管理页面必须同时更新 `MENU_ITEMS`、页面守卫和 API route 鉴权。
- 页面可见不等于 API 可写，API handler 必须单独调用 `requireAdmin()`、`requireRole()` 或 `requireActiveSession()`。
- `canAccess()` 按最长路径匹配，避免 `/dashboard` 放行 `/dashboard/admin/*`。
- session 中的角色只做第一层判断，route handler 通过 `getFreshSession()` 每次从 DB 刷新角色和状态。

## 2. 用户状态

用户状态保存在 `users.status`：

- `active`：允许登录和调用 API。
- `disabled`：禁止登录、禁止员工 Key 调用、统计和通知通常应过滤。

禁止直接删除真实员工，除非明确处理历史 usage 归属。

## 3. 员工 API Key

员工 Key 由 `web/src/lib/user-service.ts` 生成：

- 格式：`sk-emp-{name-pinyin}-{128bit hex}`
- 例：`sk-emp-zhangsan-0123456789abcdef0123456789abcdef`

存储位置：

- 新结构：`user_api_keys`
- 兼容字段：`users.api_key`, `users.api_key_hash`

安全契约：

- 明文只在创建成功响应中返回一次。
- GET 列表只返回 `maskedKey`，不能返回明文。
- 认证使用 `searchableHash()` 做 SQL 精确查询。
- 查到候选后再用解密明文做 timing-safe 二次校验。
- 删除 Key 时至少保留一个。
- 忘记 Key 只能新建，不能找回。

关键代码：

- `web/src/app/api/user/key/route.ts`
- `web/src/lib/user-api-keys.ts`
- `proxy/src/middleware/auth.ts`
- `web/src/app/api/internal/proxy/authenticate/route.ts`

## 4. 上游供应商密钥

供应商 Key 保存在 `channels.api_key`，阿里云余额查询 Secret 保存在 `channels.access_key_secret`。

安全契约：

- 写入前必须调用 `ensureEncrypted()`。
- 展示时只显示脱敏片段。
- 管理后台保存接口拒绝 `****`、`enc:v1:`、示例值、含空格换行的 Key。
- Proxy 内部读取渠道时由 Web 解密后返回给 Proxy，Proxy 不直接读 DB。
- 生产环境必须配置 `ENCRYPTION_KEY`，否则启动失败。

关键代码：

- `shared/crypto.ts`
- `web/src/lib/crypto.ts`
- `web/src/app/api/admin/channels/route.ts`
- `web/src/lib/provider-secrets.ts`
- `web/src/app/api/internal/proxy/channels/route.ts`

## 5. 内部 API

内部接口统一要求：

- Header：`Authorization: Bearer ${INTERNAL_API_KEY}`
- 校验函数：`web/src/lib/internal-auth.ts`
- 公网入口：`railway/start.mjs` 对 `/api/internal/*` 直接返回 404

内部接口包括：

- `/api/internal/proxy/authenticate`
- `/api/internal/proxy/channels`
- `/api/internal/proxy/quota/check`
- `/api/internal/proxy/quota/release`
- `/api/internal/usage`
- `/api/internal/quota-alert`
- `/api/internal/admin/reset-billing`
- `/api/internal/admin/flush-db`

维护要求：

- 不得把内部接口暴露到公网。
- 不得用用户 cookie 访问内部接口。
- `INTERNAL_API_KEY` 必须高熵、独立于 `JWT_SECRET` 和 `ENCRYPTION_KEY`。

## 6. CSRF 和浏览器安全头

`web/src/proxy.ts` 负责：

- API 写操作校验 Origin/Referer。
- 给响应加 `X-Frame-Options: DENY`。
- 给响应加 `X-Content-Type-Options: nosniff`。
- 生产加 HSTS。
- 设置 CSP。
- API 响应加 no-store。

开发新 API 时注意：

- Cookie 鉴权且有写操作的 API 必须通过同源检查。
- Bearer token 的 `/v1/*`、`/anthropic/*` 和 `/api/proxy/*` 不使用 cookie 鉴权。
- 不要为了调试关闭安全头。

## 7. SSRF 防护

渠道 Base URL 和上游请求都做安全校验：

- 管理后台保存渠道时拒绝 localhost、metadata、私网 IP、带用户名密码的 URL。
- 生产环境拒绝非 HTTPS Base URL。
- Proxy 请求前调用 `assertSafeUpstreamBaseUrl()`。

关键代码：

- `web/src/app/api/admin/channels/route.ts`
- `proxy/src/services/upstream-safety.ts`
- `web/src/lib/upstream-safety.ts`

## 8. 资金安全

资金风险集中在限额、价格和 usage 落库。

必须保持的规则：

- 任何可调用模型必须有价格，否则阻断。
- 费用由 Web 按当前 `model_prices` 重算，Proxy 不信任客户端或上游费用字段。
- 流式请求必须注入 `stream_options.include_usage=true`。
- 上游没有 usage 时可以估算，但必须记录日志。
- 用量 flush 失败不能丢，必须进入持久队列并重试。
- 429 判断要同时看已消费 `usage_logs` 和预占 `quota_reservations`。

关键代码：

- `proxy/src/services/proxy.ts`
- `proxy/src/services/usage.ts`
- `web/src/app/api/internal/usage/route.ts`
- `web/src/app/api/internal/proxy/quota/check/route.ts`
- `web/src/lib/proxy/cache.ts`

计费 fallback 口径：

- 正常情况下缺价格必须阻断。
- 如果价格表加载失败，`web/src/lib/proxy/cache.ts` 有极小 fallback 价格表，仅覆盖少量 DeepSeek 模型，目的是避免服务完全不可用。
- 汇率模块有 24 小时内存缓存，两个公开汇率 API 都失败时会使用过期缓存，最后才使用硬编码 7.2。
- 生产监控应关注 fallback 价格和 hardcoded 汇率，一旦出现需要人工复核费用。

## 9. 审计

管理员写操作应记录到 `admin_logs`：

- 渠道新增、更新、删除。
- 权限、额度、价格等关键改动。
- 后续新增敏感操作也应加审计。

当前审计差距：

- 当前代码已覆盖部分渠道和权限操作，但价格 CRUD、价格同步、预警设置、汇率刷新、余额同步、cleanup execute、reset-billing 等并非全部都有一致审计记录。
- 接手团队修复时应补齐审计覆盖，不应把当前差距理解为允许无审计操作。

要求覆盖：

- 渠道和供应商 Key。
- 模型价格和价格同步。
- 额度。
- 权限。
- 预警设置。
- 汇率刷新。
- 余额同步。
- cleanup。
- 计费重置。
- 密钥迁移。
- internal 触发的系统操作。

internal 触发时，记录为 `system/internal`，并记录触发接口、结果摘要和变更数量。

关键代码：

- `web/src/lib/audit-log.ts`
- `web/src/app/api/admin/logs/route.ts`

## 9.1 密钥生命周期

密钥类型：

- 员工 `sk-emp-...`
- 供应商 API Key
- 飞书 `FEISHU_APP_SECRET`
- `INTERNAL_API_KEY`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- 阿里云 AccessKey Secret

规则：

- 所有密钥必须有 Owner 和备份 Owner。
- 供应商 Key 应在供应商控制台限制预算或权限。
- 员工 Key 泄露时删除该 Key，让员工新建。
- 供应商 Key 泄露时先在供应商控制台停用，再在渠道管理重新录入。
- `INTERNAL_API_KEY` 泄露时必须同时更新 Web 和 Proxy 环境并重新部署。
- `JWT_SECRET` 轮换会使现有登录 session 失效，应安排窗口。
- `ENCRYPTION_KEY` 不得直接替换；直接替换会导致历史密文 Key 无法解密，必须先设计迁移方案。

## 9.2 日志脱敏

禁止在聊天、工单、日志、截图中粘贴：

- 完整员工 Key。
- 完整供应商 Key。
- `FEISHU_APP_SECRET`
- `INTERNAL_API_KEY`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- 阿里云 AccessKey Secret。

排障时只允许记录：

- 前 6 位和后 4 位。
- 已配置/未配置。
- 更新时间。
- 错误码和脱敏后的请求 ID。

供应商原始响应、dead-letter、Railway 环境变量截图在分享前必须人工脱敏。

## 9.3 安全/资金事故响应

正式事故流程见 `INCIDENT-RUNBOOK.md`。

高危事故包括：

- `INTERNAL_API_KEY` 泄露。
- 供应商 Key 泄露。
- 员工 Key 泄露。
- 异常费用暴涨。
- 飞书同步误停用。
- 计费重置或 cleanup 误触。
- usage 队列持续失败。

处置顺序：

1. 先止血。
2. 再轮换。
3. 再核账。
4. 再恢复。
5. 最后复盘。

## 10. 禁止事项

- 禁止提交真实 `FEISHU_APP_SECRET`、供应商 API Key、员工 Key。
- 禁止在日志打印完整 Key。
- 禁止让用户复制脱敏 Key 后作为真实 Key 使用。
- 禁止绕过 Web 内部 API 让 Proxy 直接读写 DB。
- 禁止在生产使用明文 secret 或默认 JWT secret。
- 禁止新增未鉴权的管理写接口。
- 禁止直接公网暴露 `3000`、`3001` 或 `/api/internal/*`。
- 生产禁止开启 `ENABLE_DEV_LOGIN`、`ENABLE_SEED_ENDPOINT`、`ENABLE_DEBUG_ENDPOINT`、`ENABLE_CLEANUP_ENDPOINT`、`ALLOW_INSECURE_*`、`ALLOW_PLAINTEXT_SECRETS_FOR_DEV`、`ALLOW_EPHEMERAL_DATA`。
