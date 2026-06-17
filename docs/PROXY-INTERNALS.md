# AI Token 管家 — Proxy 网关内部机制

> 最后更新：2025-06-08
> 本文档详细记录 Hono Proxy 网关的内部实现机制，面向接手开发或排查问题的工程师。

---

## 一、概述

Proxy 网关（`proxy/`）是一个基于 Hono 框架的轻量级 API 网关，运行在端口 3001。核心职责：

1. **API Key 鉴权** — HMAC-SHA256 哈希查找 + AES-256-GCM 解密验证
2. **限流** — 每用户滑动窗口，60 次/分钟
3. **限额检查** — 个人 → 部门 → 公司，三级递进
4. **渠道路由** — 按优先级选择渠道，支持故障转移
5. **用量记录** — 内存缓冲 + 定时批量上报
6. **费用计算** — 三级定价查找 + 汇率转换

---

## 二、中间件执行链

每个 AI 请求（`/v1/chat/completions`）经过以下中间件，**顺序固定不可调换**：

```
请求进入
  ↓
① logger()        — 全局日志（所有路由）
  ↓
② cors()          — CORS 白名单检查
  ↓
③ authMiddleware   — API Key 鉴权（HMAC-SHA256 哈希 → DB 查找 → 解密验证）
  ↓                 失败 → 401
④ rateLimitMiddleware — 滑动窗口限流（60次/分钟/用户）
  ↓                 超限 → 429
⑤ quotaMiddleware  — 三级限额检查（个人→部门→公司）
  ↓                 超额 → 429
⑥ 路由处理器       — 渠道选择 → 上游转发 → 用量记录
```

### CORS 配置

| 参数 | 值 |
|------|-----|
| `origin` | 动态回调，白名单包含 `WEB_URL`（默认 `http://localhost:3000`）+ 硬编码 `http://localhost:3000` |
| `credentials` | `true`（允许 Cookie/Auth Header） |
| 非白名单来源 | 返回 `null`，浏览器阻止请求 |

### 优雅关闭

监听 `SIGTERM` / `SIGINT` 信号：
1. `server.close()` — 停止接受新连接
2. `flushUsageToWeb()` — **排空缓冲区中的用量记录**（防止数据丢失）
3. `process.exit(0)`

> ⚠️ 如果 Docker 的 `stop_grace_period` 短于排空时间，可能丢失末尾记录。

---

## 三、认证机制（auth.ts）

### 3.1 API Key 格式

```
sk-emp-xxxxxxxxxxxx（16位随机hex，共 22 字符）
```

### 3.2 查找流程

```
请求 Header: Authorization: Bearer sk-emp-xxxxx
  ↓
① 检查前缀是否为 "sk-emp-"，否则拒绝
  ↓
② searchableHash(apiKey) → HMAC-SHA256 哈希（确定性，不可逆）
  ↓
③ SQL: SELECT * FROM users WHERE api_key_hash = <hash> LIMIT 1
  ↓
④ ensureDecrypted(user.apiKey) → AES-256-GCM 解密
  ↓
⑤ timingSafeEqual(解密后的key, 请求中的key) — 防时序攻击
  ↓
⑥ 检查 user.status !== "disabled"
  ↓
⑦ 注入上下文: userId, userName, userRole
```

### 3.3 加密参数

| 算法 | 用途 | 参数 |
|------|------|------|
| HMAC-SHA256 | 不可逆哈希索引 | key 来自 `ENCRYPTION_KEY`（或 dev fallback） |
| AES-256-GCM | 可逆加密存储 | IV 16 字节，Auth Tag 16 字节 |
| scrypt | 密钥派生 | salt: `ai-token-manager-salt-v1`，输出 32 字节 |

> 💡 `ENCRYPTION_KEY` 未配置时使用硬编码 dev key。**生产环境必须配置**。

---

## 四、限流算法（rate-limit.ts）

### 4.1 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `LIMIT_WINDOW` | 60,000 ms (60s) | 滑动窗口大小 |
| `MAX_REQUESTS` | 60 | 窗口内最大请求数 |

### 4.2 算法实现

```
每个 userId → number[]（请求时间戳数组）

收到请求:
  ① cleanup(): 过滤掉 < (now - 60000) 的时间戳
  ② if timestamps.length >= 60 → 拒绝（429）
  ③ 否则: timestamps.push(now) → 放行
```

### 4.3 返回参数

被拒绝时返回：
```json
{
  "error": {
    "type": "rate_limit_exceeded",
    "message": "Rate limit exceeded",
    "retry_after_seconds": 45  // = ceil((最旧时间戳 + 60s - now) / 1000)
  }
}
```

### 4.4 已知局限

- 内存存储，进程重启后清零
- `Map<userId, timestamps>` 无全局淘汰，随着用户增长会持续膨胀
- 只在用户下次请求时才清理其旧时间戳

---

## 五、限额检查（quota.ts）

### 5.1 缓存参数

| 缓存 | TTL | 淘汰策略 |
|------|-----|---------|
| quotaCache（限额规则） | 60s | 过期刷新 |
| usageCache（已用额度） | 60s | size > 100 时淘汰最旧 20 条 |
| cachedAdminContact（管理员联系） | 60s | 过期刷新 |

### 5.2 三级检查流程

**在 `await next()` 之前执行（阻塞式）：**

```
① 个人限额
   规则: scope="personal", targetId=userId
   已用: SELECT SUM(cost) FROM usage_logs WHERE user_id=? AND created_at>=月起始
   超额 → 429

② 部门限额（仅用户有 departmentId 时）
   规则: scope="department", targetId=departmentId
   已用: SELECT SUM(cost) JOIN users ON user_id WHERE department_id=? AND created_at>=月起始
   超额 → 429

③ 公司限额
   规则: scope="company"
   已用: SELECT SUM(cost) WHERE created_at>=月起始
   超额 → 429
```

### 5.3 预警阈值

**在 `await next()` 之后执行（非阻塞，fire-and-forget）：**

| 范围 | 阈值 | 告警类型 |
|------|------|---------|
| 个人 | 80% | `personal_80` |
| 个人 | 100% | `personal_100` |
| 部门 | 80% | `dept_80` |
| 公司 | 90% | `company_90` |

告警发送方式：`POST ${WEB_URL}/api/internal/quota-alert`（Bearer `INTERNAL_API_KEY`）

### 5.4 月度周期计算

```typescript
monthStart = Math.floor(new Date(year, month, 1).getTime() / 1000)
// Unix 时间戳（秒），每月 1 日 00:00:00
```

---

## 六、渠道路由（channel.ts）

### 6.1 缓存

| 参数 | 值 |
|------|-----|
| `CHANNEL_CACHE_TTL` | 30,000 ms (30s) |
| 存储 | 单变量 `channelCache`，包含 `channels[]` + `fetchedAt` |
| 失效 | `invalidateChannelCache()` 手动调用（如渠道配置变更时） |

### 6.2 渠道选择算法

```
getActiveChannels():
  SQL: SELECT * FROM channels WHERE status = 'active' ORDER BY priority ASC
  ↓
findChannelForModel(model):
  按优先级从高到低遍历
  返回第一个 models 数组包含目标模型名（或通配符 "*"）的渠道
  ↓
  无匹配 → 返回 null → 503 "No available channel"
```

### 6.3 故障转移

```
sendUpstreamRequest(主渠道) → 失败
  ↓
findFallbackChannel(model, excludeChannelId):
  遍历同一渠道列表
  跳过 excludeChannelId 及其同优先级/更高优先级的渠道
  返回第一个支持目标模型的低优先级渠道
  ↓
sendUpstreamRequest(备用渠道) → 失败
  ↓
返回 502 upstream_error
```

> 仅支持 **一级故障转移**。如果备用渠道也失败，直接返回错误。

---

## 七、上游请求（proxy.ts）

### 7.1 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `UPSTREAM_TIMEOUT` | 30,000 ms (30s) | 单次上游请求超时 |
| 错误文本截断 | 200 字符 | 非 2xx 响应体只取前 200 字符 |

### 7.2 非流式请求

```
fetch(upstream_url, { signal: AbortSignal.timeout(30s) })
  ↓
读取完整响应体 → JSON.parse
  ↓
解析失败 → 原样透传
  ↓
提取 usage → 记录用量
```

### 7.3 流式请求（SSE）

```
fetch(upstream_url, { signal: AbortSignal.timeout(30s) })
  ↓
创建 ReadableStream，pull() 中逐块转发
  ↓
buffer 累积文本，按 "\n" 分割
  ↓
提取每个 "data: " 行的 JSON
  ↓
保留最后一个含 usage 对象的 chunk → lastUsage
  ↓
流结束 / 读错误 / 客户端取消 → 记录 lastUsage
```

**流式响应头：**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

---

## 八、用量记录（usage.ts）

### 8.1 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `FLUSH_INTERVAL_MS` | 2,000 ms (2s) | 定时 flush 间隔 |
| `MAX_BATCH_SIZE` | 50 条 | 单次最大批量上报 |

### 8.2 缓冲区机制

```
每次请求完成 → pushRecord()
  ↓
① usage.totalTokens === 0 → 静默跳过（不记录零 token 请求）
  ↓
② 生成 16 位 hex 随机 ID (randomBytes(8).toString("hex"))
  ↓
③ 推入 pendingRecords[] 数组
  ↓
④ 如果是缓冲区从空到有的第一条记录 → setTimeout(flush, 2000)
  ↓
⑤ 如果 pendingRecords.length >= 50 → 清除 timer，立即 flush
```

### 8.3 Flush 流程

```
flushUsageToWeb():
  ① pendingRecords.splice(0, 50) 取出最多 50 条
  ② POST ${WEB_URL}/api/internal/usage
     Header: Authorization: Bearer ${INTERNAL_API_KEY}
  ③ 失败 → lostRecordCount += 本批数量（永久丢失，不重试）
  ④ 缓冲区还有剩余 → 立即再 flush
```

> ⚠️ **无重试机制**。失败的记录计入 `lostRecordCount` 并永久丢弃。
> 优雅关闭时会执行最后一次 flush 以减少丢失。

---

## 九、费用计算（pricing.ts）

### 9.1 缓存

| 参数 | 值 |
|------|-----|
| `CACHE_TTL_MS` | 60,000 ms (60s) |
| 失效 | `invalidatePriceCache()` 手动调用 |

### 9.2 三级定价查找

```
calculateCost(model, channelId, inputTokens, outputTokens, cachedTokens):
  ↓
① 渠道特定价格
   key = "${channelId}:${model}"
   在 model_prices 表中查找 channelId 匹配的行
   ↓ 找到 → 使用
   ↓ 未找到 ↓
② 全局价格
   key = ":${model}"
   在 model_prices 表中查找 channelId IS NULL 的行
   ↓ 找到 → 使用
   ↓ 未找到 ↓
③ 硬编码兜底价格
   直接使用 deepseek-chat 的价格（无论实际模型名是什么）
```

### 9.3 硬编码兜底价格

| 模型 | Input (CNY/1M tokens) | Output (CNY/1M tokens) | Cache (CNY/1M tokens) |
|------|----------------------|----------------------|---------------------|
| `deepseek-chat` | 1.0 | 2.0 | 0.1 |
| `deepseek-reasoner` | 4.0 | 16.0 | 0.4 |

### 9.4 计费公式

```typescript
nonCached = Math.max(0, inputTokens - cachedTokens)
cost = (nonCached * inputPrice + cachedTokens * cachePrice + outputTokens * outputPrice) / 1_000_000

// 如果币种为 USD:
cost *= exchangeRate  // 默认 7.2（汇率获取失败时）
```

---

## 十、汇率获取（exchange-rate.ts）

### 10.1 参数

| 参数 | 值 |
|------|-----|
| `FALLBACK_RATE` | 7.2 CNY/USD |
| `CACHE_TTL` | 86,400,000 ms (24 小时) |
| API 超时 | 10,000 ms (10s) |

### 10.2 API 端点（优先级）

| 优先级 | 端点 | 提取路径 |
|--------|------|---------|
| 1 (主) | `https://open.er-api.com/v6/latest/USD` | `data.rates.CNY` |
| 2 (备) | `https://api.exchangerate-api.com/v4/latest/USD` | `data.rates.CNY` |

### 10.3 获取流程

```
getExchangeRate():
  ↓
① 内存缓存有效（< 24h）→ 直接返回
  ↓
② 有正在进行的请求？→ await 同一 Promise（防并发重复请求）
  ↓
③ fetch 主 API（10s 超时）
  ↓ 成功 → 缓存 + 返回
  ↓ 失败 ↓
④ fetch 备 API（10s 超时）
  ↓ 成功 → 缓存 + 返回
  ↓ 失败 ↓
⑤ 使用过期的缓存（如果有）→ 返回
  ↓ 无缓存 ↓
⑥ 返回硬编码 7.2
```

### 10.4 并发保护

模块级 `pending` Promise：多个调用同时请求汇率时，只发出一次 API 请求，其余调用 await 同一 Promise。

---

## 十一、完整常量速查表

| 文件 | 常量 | 值 | 单位 |
|------|------|-----|------|
| index.ts | 默认端口 | 3001 | TCP |
| auth.ts | Key 前缀 | `sk-emp-` | — |
| rate-limit.ts | `LIMIT_WINDOW` | 60,000 | ms (60s) |
| rate-limit.ts | `MAX_REQUESTS` | 60 | 次/分钟 |
| quota.ts | `CACHE_TTL_MS` | 60,000 | ms (60s) |
| quota.ts | 缓存淘汰触发 | 100 | 条 |
| quota.ts | 缓存淘汰批量 | 20 | 条 |
| channel.ts | `CHANNEL_CACHE_TTL` | 30,000 | ms (30s) |
| proxy.ts | `UPSTREAM_TIMEOUT` | 30,000 | ms (30s) |
| proxy.ts | 错误文本截断 | 200 | 字符 |
| usage.ts | `FLUSH_INTERVAL_MS` | 2,000 | ms (2s) |
| usage.ts | `MAX_BATCH_SIZE` | 50 | 条 |
| pricing.ts | `CACHE_TTL_MS` | 60,000 | ms (60s) |
| pricing.ts | 计费除数 | 1,000,000 | tokens |
| exchange-rate.ts | `FALLBACK_RATE` | 7.2 | CNY/USD |
| exchange-rate.ts | `CACHE_TTL` | 86,400,000 | ms (24h) |
| exchange-rate.ts | API 超时 | 10,000 | ms (10s) |

### 兜底价格

| 模型 | Input | Output | Cache | 币种 |
|------|-------|--------|-------|------|
| deepseek-chat | 1.0 | 2.0 | 0.1 | CNY/1M tokens |
| deepseek-reasoner | 4.0 | 16.0 | 0.4 | CNY/1M tokens |

### 预警阈值

| 范围 | 阈值 | 告警类型 |
|------|------|---------|
| 个人 | 80% | `personal_80` |
| 个人 | 100% | `personal_100` |
| 部门 | 80% | `dept_80` |
| 公司 | 90% | `company_90` |
