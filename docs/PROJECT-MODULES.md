# 模块功能说明

最后更新：2026-06-18

本文档按代码模块说明功能点、关键文件、维护规范。

## 1. Web 管理后台

路径：`web/`

技术栈：

- Next.js 16
- React 19
- Tailwind CSS 4
- Drizzle ORM
- sql.js

职责：

- 登录页和 Dashboard。
- 用户、管理员、财务、部门负责人页面。
- 管理 API。
- 内部 API。
- DB owner。
- 飞书同步和通知。
- 定时任务。

## 2. 登录认证模块

关键文件：

- `web/src/app/api/auth/feishu/start/route.ts`
- `web/src/app/api/auth/feishu/callback/route.ts`
- `web/src/app/api/auth/logout/route.ts`
- `web/src/app/api/auth/me/route.ts`
- `web/src/lib/auth.ts`
- `web/src/lib/feishu.ts`
- `web/src/lib/user-service.ts`

功能：

- 生成 OAuth state。
- 跳转飞书授权。
- code 换 user access token。
- 拉取用户信息和部门信息。
- 创建或更新用户。
- 设置 JWT cookie。
- 退出登录。

维护规范：

- 飞书回调地址必须和开放平台配置完全一致。
- session 签名必须使用强 `JWT_SECRET`。
- 生产不允许 fallback secret。
- 用户登录时只补充部门信息，不应清空飞书同步获得的组织结构。

## 3. 权限模块

关键文件：

- `web/src/lib/permissions.ts`
- `web/src/lib/admin-check.ts`
- `web/src/proxy.ts`

功能：

- 定义角色。
- 定义菜单。
- 页面访问控制。
- API route 鉴权。
- 用户状态刷新。
- CSRF/安全响应头。

维护规范：

- 新增页面先改 `MENU_ITEMS`。
- 新增 API 必须显式调用鉴权函数。
- dept_manager 和 finance 必须在 SQL 层限制数据范围。

## 4. 用户 API Key 模块

关键文件：

- `web/src/app/api/user/key/route.ts`
- `web/src/lib/user-api-keys.ts`
- `web/src/lib/user-service.ts`

功能：

- 新建员工 Key。
- 一次性返回明文。
- 列出脱敏 Key。
- 删除 Key。
- 保证至少保留一个 Key。
- 服务端限制每个员工的 Key 数量和新建频率，默认最多 5 个、60 秒冷却。
- 维护兼容字段 `users.api_key` 和 `users.api_key_hash`。

维护规范：

- GET 不能返回明文。
- POST 只能返回当次新建 Key 的明文。
- Key 认证使用 hash 查询。
- 不得允许复制脱敏 Key 作为真实 Key。

## 5. 渠道管理模块

关键文件：

- `web/src/app/api/admin/channels/route.ts`
- `web/src/app/api/admin/channels/balance-sync/route.ts`
- `web/src/lib/provider-secrets.ts`
- `web/src/lib/balance-sync.ts`
- `web/src/lib/balance-fetchers.ts`

功能：

- 渠道增删改查。
- Base URL 校验。
- 供应商 Key 加密存储。
- Key 脱敏展示。
- 渠道启停。
- 模型列表维护。
- 优先级维护。
- 余额自动/手动同步。
- 余额阈值。

维护规范：

- 生产 Base URL 必须 HTTPS。
- 拒绝私网、localhost、metadata。
- 拒绝脱敏 Key 和 `enc:v1:`。
- disabled 渠道不参与调用和余额告警。

## 6. 模型价格模块

关键文件：

- `web/src/app/api/admin/prices/route.ts`
- `web/src/app/api/admin/prices/sync/route.ts`
- `web/src/lib/price-sync.ts`
- `web/src/lib/price-scrapers/*`
- `web/src/lib/proxy/cache.ts`

功能：

- 模型价格 CRUD。
- 渠道专属价格。
- 全局价格。
- 官方价格同步。
- fallback 价格。
- 手动价格保护。
- 删除后写入同步黑名单。
- USD/CNY 汇率换算。

维护规范：

- 缺价模型必须阻断调用。
- 手动编辑设置 `syncedAt=null`，自动同步不覆盖。
- fallback 价格不能覆盖已有价格。
- 删除模型价格必须写 `sync_blacklist`。

## 7. 限额和计费模块

关键文件：

- `web/src/app/api/admin/quotas/route.ts`
- `web/src/app/api/internal/proxy/quota/check/route.ts`
- `web/src/app/api/internal/proxy/quota/release/route.ts`
- `web/src/app/api/internal/usage/route.ts`
- `web/src/lib/quota-alerts.ts`
- `web/src/lib/proxy/cache.ts`
- `proxy/src/services/usage.ts`

功能：

- 公司、部门、个人月度额度。
- 请求前预占额度。
- 请求失败释放预占。
- usage 上报。
- 费用按价格表重算。
- 达阈值飞书通知。

维护规范：

- 额度 `0` 是硬阻断。
- 429 排查必须同时看 usage 和 reservation。
- 费用计算不能信任客户端输入。
- usage flush 失败必须重试，不能丢。

## 8. 飞书通讯录同步模块

关键文件：

- `web/src/app/api/setup/sync-feishu/route.ts`
- `web/src/app/api/setup/sync-feishu/execute-sync.ts`
- `web/src/app/api/setup/sync-feishu/cleanup.ts`
- `web/src/app/api/setup/sync-feishu/normalize.ts`
- `web/src/app/api/setup/sync-feishu/constants.ts`
- `web/src/lib/feishu.ts`

功能：

- 拉取部门树。
- 拉取部门用户。
- 分类中心、部门、组。
- 创建或更新用户。
- 维护部门映射。
- 清理模拟用户。
- 识别离职候选并保护性停用。
- 管理员保护。

维护规范：

- 部门映射当前在代码常量中维护。
- 飞书数据范围变化后必须先手动同步验证。
- 大量离职候选不能自动停用，应先排查权限和数据范围。

## 9. 飞书通知模块

关键文件：

- `web/src/lib/feishu-bot.ts`
- `web/src/lib/notification-router.ts`
- `web/src/lib/leaderboard.ts`
- `web/src/app/api/admin/alerts/settings/route.ts`
- `web/src/app/api/admin/feishu/chats/route.ts`

功能：

- 私聊消息。
- 群卡片消息。
- 通知开关。
- 通知类型开关。
- 管理员接收人。
- 机器人群列表。
- 排行榜生成和发送。

维护规范：

- 个人额度通知直接发用户本人。
- 管理类通知未配置接收人时回退全部活跃管理员。
- 群消息要求机器人在群内且有权限。

## 10. Hono Proxy 模块

路径：`proxy/`

关键文件：

- `proxy/src/index.ts`
- `proxy/src/middleware/auth.ts`
- `proxy/src/middleware/rate-limit.ts`
- `proxy/src/routes/models.ts`
- `proxy/src/routes/chat.ts`
- `proxy/src/routes/anthropic.ts`
- `proxy/src/services/proxy.ts`
- `proxy/src/services/anthropic.ts`
- `proxy/src/services/channel.ts`
- `proxy/src/services/web-internal.ts`
- `proxy/src/services/usage.ts`

功能：

- 员工 Key 鉴权。
- 模型列表。
- OpenAI chat completions。
- Anthropic messages。
- 限频。
- 渠道查找。
- 上游转发。
- usage 抽取。
- 持久队列。

维护规范：

- Proxy 不直接读 SQLite。
- 内部请求必须带 `INTERNAL_API_KEY`。
- 流式请求必须支持中断计费。
- 上游 Base URL 必须安全校验。

## 11. Shared 模块

路径：`shared/`

关键文件：

- `shared/schema.ts`
- `shared/crypto.ts`
- `shared/db.ts`
- `shared/migrate.ts`
- `shared/types.ts`

功能：

- Drizzle schema。
- 共享加密工具。
- 迁移辅助。
- 共享类型。

维护规范：

- 表结构变更先改 `shared/schema.ts`。
- 兼容旧数据的运行时迁移在 `web/src/lib/ensure-tables.ts`。
- 加密逻辑需兼容 Web 和可能的共享调用。
