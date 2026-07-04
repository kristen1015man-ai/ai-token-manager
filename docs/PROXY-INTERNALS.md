# Hono Proxy 内部说明

最后更新：2026-06-18

本文档描述 `proxy/` 服务的请求链路、计费链路和维护规范。

## 1. 入口

主入口：`proxy/src/index.ts`

路由：

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /anthropic/v1/messages`
- `POST /anthropic/v1/messages/count_tokens`，本地估算 token，不调用上游

中间件：

- CORS：`hono/cors`
- 日志：`hono/logger`
- 员工 Key 鉴权：`proxy/src/middleware/auth.ts`
- 限频：`proxy/src/middleware/rate-limit.ts`

## 2. 鉴权

支持两种 header：

```http
Authorization: Bearer sk-emp-...
```

或：

```http
x-api-key: sk-emp-...
```

规则：

- Key 必须以 `sk-emp-` 开头。
- Proxy 不查本地 DB。
- Proxy 调 Web 内部接口 `/api/internal/proxy/authenticate`。
- Web 用 HMAC hash 查找，再 timing-safe 比对明文。
- 用户不存在或 disabled 返回 401。

## 2.1 限频边界

当前限频在 `proxy/src/middleware/rate-limit.ts`：

- 内存滑动窗口。
- 按 `userId` 计数。
- 每用户每分钟 60 次。

边界：

- Proxy 重启后计数清空。
- 多实例横向扩展时不共享计数。
- 该限频不能替代月额度、供应商控制台预算或风控。
- 如未来多实例部署，需要迁移到 Redis 或外部限频服务。

## 3. 渠道选择

关键文件：

- `proxy/src/services/channel.ts`
- `web/src/app/api/internal/proxy/channels/route.ts`

流程：

1. Proxy 传入模型名。
2. Web 查询 active channels。
3. Web 过滤支持该模型的渠道。
4. Web 过滤没有价格的模型。
5. Web 解密上游 Key。
6. Web 按 priority 排序返回。
7. Proxy 选择第一个匹配渠道。

缓存：

- Proxy 侧渠道缓存 TTL 30 秒。
- 模型列表也来自 Web 内部渠道接口。

## 4. 请求转发

OpenAI 兼容：

- Proxy 上游 URL：`{channel.baseUrl}/v1/chat/completions`
- 请求体原样透传，但会确保 `model` 存在。
- 流式请求注入 `stream_options.include_usage=true`。

Anthropic 兼容：

- 路由在 `proxy/src/routes/anthropic.ts`
- 服务实现在 `proxy/src/services/anthropic.ts`
- 透传 `anthropic-version` 和 `anthropic-beta`。

安全：

- 请求上游前调用 `assertSafeUpstreamBaseUrl()`。
- 防止 SSRF 到 localhost、私网、metadata。
- 请求体大小默认 2MB，可通过 `MAX_CHAT_BODY_BYTES` 调整。

## 5. 限额预占

关键文件：

- `proxy/src/services/proxy.ts`
- `proxy/src/services/web-internal.ts`
- `web/src/app/api/internal/proxy/quota/check/route.ts`

流程：

1. Proxy 估算输入 token。
2. Proxy 根据 `max_completion_tokens` 或 `max_tokens` 估算输出 token。
3. 未设置时默认预留 `QUOTA_DEFAULT_OUTPUT_TOKEN_RESERVE`，默认 2000；显式 `max_tokens` 会受 `QUOTA_MAX_OUTPUT_TOKEN_RESERVE` 限制，默认最多按 8192 输出 token 预占，避免 Claude Code 这类客户端用超大理论上限误触发 429。
4. Proxy 调 Web quota check。
5. Web 按个人、部门、公司额度检查。
6. Web 写 `quota_reservations`。
7. 如果超限，Proxy 返回 429。

释放：

- 上游失败时调用 `/api/internal/proxy/quota/release`。
- usage 成功落库时 Web 删除 reservation。
- 过期 reservation 会在 quota check 时清理。

## 6. 用量提取

关键文件：`proxy/src/services/usage.ts`

非流式：

- 从上游 JSON `usage` 提取：
  - `prompt_tokens`
  - `completion_tokens`
  - `total_tokens`
  - `prompt_tokens_details.cached_tokens`
  - `prompt_cache_hit_tokens`
  - `cache_read_input_tokens`
- 如果没有 usage，则按请求和响应文本估算。

流式：

- 解析 SSE chunk。
- 如果 chunk 有 `usage`，记录最后一次 usage。
- 如果直到结束都没有 usage，按已流式输出字符估算。
- 如果客户端取消，也会尝试记录估算 usage。

## 7. 用量队列

Proxy 不直接写 DB，而是向 Web 上报。

队列文件：

- `USAGE_QUEUE_FILE`，Docker Compose 默认 `/usage/usage-queue.jsonl`；Railway 单镜像通常配置为 `/data/usage-queue.jsonl`
- `USAGE_DEAD_LETTER_FILE`，Docker Compose 默认 `/usage/usage-dead-letter.jsonl`；Railway 单镜像通常配置为 `/data/usage-dead-letter.jsonl`

行为：

- 每次 usage 先进入内存队列。
- 同时 append 到持久队列文件。
- 每 2 秒 flush 一次。
- 批量大小 50。
- Web 不可用时 5 秒后重试。
- Web 明确拒绝记录时写 dead-letter，并从重试队列移除，避免永久坏数据无限重试。
- Proxy 启动时加载持久队列。
- SIGTERM/SIGINT 时 flush。

内部维护：

- `POST /internal/admin/usage-queue/clear` 可由 Web 使用 `INTERNAL_API_KEY` 调用。
- 该入口还要求 `ENABLE_PROXY_USAGE_QUEUE_CLEAR=true` 和请求头 `x-sparkloom-maintenance-confirm: reset-billing-usage`。
- `reset-billing` 会先清 Proxy 内存 queue；如果清理失败，会中止重置，避免旧 usage 在重置后写回。
- 维护完成后必须关闭 `ENABLE_PROXY_USAGE_QUEUE_CLEAR`。
- dead-letter 不是自动重试队列，人工确认和补账前不得直接回灌。

## 8. 费用计算边界

Proxy 不计算最终费用。

原因：

- 价格表在 Web DB。
- 费用需要按照最新 `model_prices`。
- 需要支持渠道专属价格、全局价格、USD 汇率和缓存价。

Proxy 上报：

- userId
- model
- channelId
- reservationId
- inputTokens
- outputTokens
- cachedTokens
- totalTokens
- createdAt

Web 落库时计算人民币 cost。

fallback 说明：

- Web 价格表正常时，缺价模型必须阻断。
- 如果 Web 侧价格表加载失败，`web/src/lib/proxy/cache.ts` 有少量 DeepSeek fallback 价格，只作为防御性兜底。
- 汇率有 24 小时缓存；两个公开汇率 API 都失败时会使用过期缓存，最后才用硬编码 7.2。
- 出现 fallback 价格或 hardcoded 汇率时，运维必须标记为需要人工复核的资金风险。

日志规则：

- Proxy 可能记录上游错误片段，排障分享前必须脱敏。
- usage dead-letter 可能保存 rejected record，不能直接贴到聊天或工单。
- 不得在日志中输出完整员工 Key、供应商 Key 或 `INTERNAL_API_KEY`。

## 9. Fallback 渠道

流程：

1. 主渠道请求失败。
2. 释放主渠道 reservation。
3. 查找同模型后续低优先级渠道。
4. 为 fallback 渠道重新做额度预占。
5. 请求 fallback。
6. 如果 fallback 也失败，返回 502。

注意：

- fallback 只处理请求异常或上游非 OK。
- fallback 不会绕过模型价格和限额。

## 10. 健康检查

`GET /health`

公网响应：

- status
- service
- timestamp

内部详细响应需要：

```http
Authorization: Bearer ${INTERNAL_API_KEY}
```

详细内容：

- internalKeyConfigured
- webUrl
- Web health
- usageQueue pending 数量
- queue file 路径
- dead-letter file 路径
- queue/dead-letter 目录可写性

## 11. 常见改动规范

新增公开模型接口时：

- 加鉴权中间件。
- 加限频中间件。
- 明确是否需要限额预占。
- 明确 usage 如何记录。
- 写入 `API.md`。

改计费逻辑时：

- 同时检查非流式、流式、取消、中断、无 usage 场景。
- 同时检查 `usage_logs` 和 `quota_reservations`。
- 不得丢弃 flush 失败的 usage。

改渠道选择时：

- 不得绕过 Web 内部渠道接口。
- 不得把 disabled 渠道返回给 Proxy。
- 不得返回无价格模型。
