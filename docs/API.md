# AI Token Manager — API 接口文档

> 最后更新：2025-06-08
> 基础 URL：`https://ai.seapllo.com`（生产）/ `http://localhost:3000`（本地）

---

## 通用说明

### 认证方式

| 方式 | Header 格式 | 适用端点 |
|------|------------|---------|
| **飞书 OAuth + JWT** | Cookie 自动携带 | 前端页面 + 管理 API |
| **API Key** | `Authorization: Bearer sk-emp-xxx` | AI 代理接口（/v1/*） |
| **INTERNAL_API_KEY** | `Authorization: Bearer sk-internal-xxx` | 内部定时任务调用 |

### 时间范围参数（`range`）

所有带 `range` 参数的接口支持以下值：

| 值 | 含义 |
|----|------|
| `day` | 今天 |
| `7d` | 最近 7 天 |
| `30d` | 最近 30 天 |
| `year` | 今年（1月1日起） |
| `YYYY-MM` | 指定月份（如 `2025-06`） |

### 通用错误响应

```json
{
  "error": "错误描述信息"
}
```

| HTTP 状态码 | 含义 |
|-------------|------|
| 400 | 请求参数错误 |
| 401 | 未认证或认证失败 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 409 | 资源冲突 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |

### 通用响应格式

成功响应均返回 JSON 对象，包含业务数据或 `{ "success": true }`。
列表接口通常返回 `{ "items": [...], "pagination": {...} }` 或 `{ "key": [...] }` 格式。

---

## 一、认证接口

### 1.1 发起飞书登录

```
GET /api/auth/feishu/start
```

**权限**：公开

**说明**：生成 CSRF state，设置 HttpOnly Cookie，重定向到飞书授权页。

**响应**：302 重定向到飞书 OAuth URL

---

### 1.2 飞书 OAuth 回调

```
GET /api/auth/feishu/callback?code=xxx&state=yyy
```

**权限**：公开（由飞书重定向调用）

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | ✅ | 飞书授权码 |
| state | string | ✅ | CSRF 令牌（与 Cookie 比对） |

**响应**：
- ✅ 成功：302 重定向到 `/dashboard`
- ❌ 失败：302 重定向到 `/login?error=xxx`

**副作用**：创建/更新用户记录，设置 JWT Cookie

---

### 1.3 获取当前用户信息

```
GET /api/auth/me
```

**权限**：JWT 登录用户

**响应**：

```json
{
  "user": {
    "id": "u_051",
    "name": "何广明",
    "avatar": "https://xxx.feishu.cn/avatar/xxx",
    "role": "admin",
    "department": "产品部",
    "email": "xxx@company.com"
  }
}
```

---

### 1.4 退出登录

```
POST /api/auth/logout
```

**权限**：JWT 登录用户

**响应**：

```json
{ "success": true }
```

---

### 1.5 开发环境快捷登录

```
GET /api/auth/dev-login
```

**权限**：公开（**仅限开发环境，生产环境返回 403**）

**说明**：创建管理员 "何广明" 的 session，直接跳转到管理面板。方便本地开发调试。

**响应**：302 重定向到 `/dashboard/admin`

---

## 二、用量查询接口

### 2.1 用量汇总

```
GET /api/usage/summary?range=day
```

**权限**：JWT 登录用户

**Query 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| range | string | `"day"` | 时间范围 |

**响应**：

```json
{
  "tokens": 150000,
  "cost": 12.50,
  "count": 42,
  "rangeLabel": "今天",
  "monthlyQuota": 200,
  "quotaUsed": 12.50,
  "quotaRemaining": 187.50
}
```

---

### 2.2 用量趋势图

```
GET /api/usage/chart?range=30d
```

**权限**：JWT 登录用户

**说明**：粒度自动调整 — `day`/`7d` 按小时，`30d`/`YYYY-MM` 按天，`year` 按月。

**响应**：

```json
{
  "range": "30d",
  "label": "最近 30 天",
  "data": [
    { "time": "2025-05-10", "tokens": 50000, "cost": 3.20 },
    { "time": "2025-05-11", "tokens": 62000, "cost": 4.15 }
  ]
}
```

---

### 2.3 按模型分组

```
GET /api/usage/by-model?range=30d
```

**权限**：JWT 登录用户

**响应**：

```json
{
  "models": [
    { "model": "deepseek-chat", "tokens": 100000, "cost": 8.50, "count": 30 },
    { "model": "gpt-4o", "tokens": 50000, "cost": 4.00, "count": 12 }
  ]
}
```

---

### 2.4 用量明细

```
GET /api/usage/details?page=1&size=20
```

**权限**：JWT 登录用户

**Query 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| size | number | 20 | 每页条数 |

**响应**：

```json
{
  "items": [
    {
      "id": "log_001",
      "model": "deepseek-chat",
      "inputTokens": 5000,
      "outputTokens": 2000,
      "totalTokens": 7000,
      "cost": 0.35,
      "createdAt": 1718000000
    }
  ],
  "pagination": {
    "page": 1,
    "size": 20,
    "total": 156,
    "totalPages": 8
  }
}
```

---

## 三、用户 API Key 接口

### 3.1 查看 API Key（脱敏）

```
GET /api/user/key
```

**权限**：JWT 登录用户

**响应**：

```json
{
  "maskedKey": "sk-emp-****a1b2",
  "proxyUrl": "https://ai.seapllo.com/v1"
}
```

---

### 3.2 重新生成 API Key

```
POST /api/user/key
```

**权限**：JWT 登录用户

**说明**：生成新的 API Key，旧的立即失效。完整 Key 只返回一次。

**响应**：

```json
{
  "apiKey": "sk-emp-<only-returned-once>",
  "maskedKey": "sk-emp-****abcd",
  "proxyUrl": "https://ai.seapllo.com/v1"
}
```

---

## 四、AI 代理接口（OpenAI 兼容）

### 4.1 Chat Completions

```
POST /api/proxy/v1/chat/completions
```

**权限**：`Authorization: Bearer sk-emp-xxx`

**说明**：OpenAI API 兼容端点，支持流式(SSE)和非流式响应。经过鉴权→限流→限额→渠道路由→故障转移的完整链路。

**请求体**（OpenAI 格式）：

```json
{
  "model": "deepseek-chat",
  "stream": true,
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 4096
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| model | string | ✅ | 模型名称 |
| messages | array | ✅ | 消息数组 |
| stream | boolean | ❌ | 是否流式，默认 false |
| temperature | number | ❌ | 0-2 |
| max_tokens | integer | ❌ | 最大输出 Token |

**限流**：60 次/分钟（滑动窗口）

**错误码**：

| 状态码 | 说明 |
|--------|------|
| 401 | API Key 无效或用户已禁用 |
| 403 | 超过月度限额 |
| 429 | 请求频率超限 |
| 502 | 所有渠道均不可用 |

---

### 4.2 模型列表

```
GET /api/proxy/v1/models
```

**权限**：`Authorization: Bearer sk-emp-xxx`

**响应**：

```json
{
  "object": "list",
  "data": [
    {
      "id": "deepseek-chat",
      "object": "model",
      "created": 1718000000,
      "owned_by": "proxy"
    },
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1718000000,
      "owned_by": "proxy"
    }
  ]
}
```

---

## 五、管理接口

> 以下接口均需要 **JWT + admin 角色**（特殊标注的除外）。

---

### 5.1 全局概览

```
GET /api/admin/overview?range=30d&includeBalance=true
```

**权限**：admin 或 finance

**Query 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| range | string | `"30d"` | 时间范围 |
| includeBalance | string | `"false"` | 是否包含余额汇总（仅 admin） |

**响应**：

```json
{
  "cost": 12500.00,
  "tokens": 15000000,
  "count": 3200,
  "activeUsers": 45,
  "rangeLabel": "最近 30 天",
  "trend": [
    { "day": "2025-05-10", "tokens": 500000, "cost": 400.00 }
  ],
  "range": "30d",
  "balanceSummary": {
    "channels": [
      { "id": "ch_001", "name": "DeepSeek 官方", "balance": 5000, "currency": "CNY" }
    ],
    "totalBalance": 15000,
    "totalCurrency": "CNY"
  }
}
```

---

### 5.2 部门排行

```
GET /api/admin/departments?level=department&range=30d
```

**权限**：admin、finance 或 dept_manager

**Query 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| level | string | `"department"` | 聚合层级：`department` / `group` / `center` |
| range | string | `"30d"` | 时间范围 |

**响应**：

```json
{
  "departments": [
    {
      "department": "产品部",
      "userCount": 12,
      "tokens": 5000000,
      "cost": 3500.00,
      "avgCost": "291.67"
    }
  ],
  "level": "department"
}
```

---

### 5.3 员工排行

```
GET /api/admin/employees?department=产品部&range=30d&level=department
```

**权限**：admin 或 dept_manager

**Query 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| department | string | — | 部门筛选（可选） |
| range | string | `"30d"` | 时间范围 |
| level | string | `"department"` | 聚合层级 |

**响应**：

```json
{
  "employees": [
    {
      "name": "张三",
      "department": "产品部",
      "avatar": "https://xxx.feishu.cn/avatar/xxx",
      "tokens": 500000,
      "cost": 350.00,
      "count": 120
    }
  ],
  "departments": ["产品部", "技术部", "运营部"],
  "level": "department"
}
```

---

### 5.4 渠道管理

#### 列表 / 新增

```
GET  /api/admin/channels
POST /api/admin/channels
```

**GET 响应**：

```json
{
  "channels": [
    {
      "id": "ch_001",
      "name": "DeepSeek 官方",
      "baseUrl": "https://api.deepseek.com",
      "apiKey": "sk-****a1b2",
      "models": "[\"deepseek-chat\",\"deepseek-reasoner\"]",
      "priority": 10,
      "status": "active",
      "currency": "CNY",
      "provider": "deepseek",
      "balance": 5000.00,
      "balanceCurrency": "CNY",
      "balanceSyncMode": "auto",
      "balanceSyncedAt": 1718000000,
      "balanceAlertThreshold": 500,
      "accessKeyId": null,
      "accessKeySecret": null
    }
  ]
}
```

**POST 请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ | 渠道名称 |
| baseUrl | string | ✅ | API 地址 |
| apiKey | string | ✅ | 渠道密钥 |
| models | string | ✅ | 支持模型（JSON 数组字符串） |
| priority | number | ❌ | 优先级（默认 0） |
| status | string | ❌ | `active` 或 `disabled` |
| currency | string | ❌ | `CNY` 或 `USD` |
| provider | string | ❌ | 服务商标识 |

#### 更新 / 删除

```
PUT    /api/admin/channels
DELETE /api/admin/channels
```

**PUT 请求体**：`id` 必填 + 需要更新的字段。

**DELETE 请求体**：`{ "id": "ch_001" }`

#### 余额同步

```
POST /api/admin/channels/balance-sync
```

**请求体**：

```json
{ "channelId": "ch_001" }
```

省略 `channelId` 则同步所有 `balanceSyncMode = "auto"` 的渠道。

**响应**：同步结果 + 低余额渠道自动发飞书预警。

---

### 5.5 模型价格

#### 列表 / 新增

```
GET  /api/admin/prices
POST /api/admin/prices
```

**GET 响应**：

```json
{
  "prices": [
    {
      "id": "p_001",
      "model": "deepseek-chat",
      "channelId": null,
      "inputPerMillion": 1.00,
      "outputPerMillion": 2.00,
      "cachePerMillion": 0.10,
      "displayName": "DeepSeek Chat",
      "currency": "CNY",
      "deprecated": false,
      "syncedAt": null,
      "channelName": null,
      "channelCurrency": null,
      "channelProvider": null
    }
  ],
  "exchangeRate": { "rate": 7.25, "source": "open.er-api.com" }
}
```

**POST 请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| model | string | ✅ | 模型名 |
| channelId | string | ❌ | 渠道 ID（null=全局） |
| inputPerMillion | number | ✅ | 输入单价（每百万 Token） |
| outputPerMillion | number | ✅ | 输出单价 |
| cachePerMillion | number | ❌ | 缓存单价 |
| displayName | string | ❌ | 显示名称 |
| currency | string | ❌ | 币种 |

> ⚠️ 同一 `(channelId, model)` 组合唯一，重复返回 409。

#### 更新 / 删除

```
PUT    /api/admin/prices
DELETE /api/admin/prices
```

**DELETE** 会自动将模型加入 `sync_blacklist`（防止官方同步覆盖手动定价）。

#### 官方价格同步

```
POST /api/admin/prices/sync
```

**权限**：admin 或 INTERNAL_API_KEY

**响应**：同步结果（从各厂商官网爬取最新定价）。

---

### 5.6 限额管理

```
GET  /api/admin/quotas
POST /api/admin/quotas
```

**GET 响应**：

```json
{
  "rules": [
    { "id": "qr_001", "scope": "company", "targetId": "__company__", "monthlyLimit": 50000, "updatedBy": "u_051", "updatedAt": 1718000000 },
    { "id": "qr_002", "scope": "personal", "targetId": "u_051", "monthlyLimit": 500, "updatedBy": null, "updatedAt": 1718000000 }
  ],
  "users": [
    { "id": "u_051", "name": "何广明", "avatar": "...", "department": "产品部", "monthlyQuota": 500 }
  ],
  "companyLimit": 50000,
  "departments": ["产品部", "技术部", "运营部"]
}
```

**POST 请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| scope | string | ✅ | `company` / `department` / `personal` |
| targetId | string | ✅ | 目标 ID（公司用 `__company__`） |
| monthlyLimit | number | ✅ | 月度限额（元） |

**说明**：Upsert 逻辑 — 已有规则则更新，否则创建。`scope=personal` 时同时更新 `users.monthlyQuota`。

---

### 5.7 分账数据

#### 按模型

```
GET /api/admin/billing/by-model?range=30d
```

**响应**：

```json
{
  "models": [
    { "model": "deepseek-chat", "tokens": 5000000, "cost": 3500.00, "count": 1200 },
    { "model": "gpt-4o", "tokens": 2000000, "cost": 800.00, "count": 500 }
  ]
}
```

#### 按渠道

```
GET /api/admin/billing/by-channel?range=30d
```

**响应**：

```json
{
  "channels": [
    { "channelId": "ch_001", "channelName": "DeepSeek 官方", "channelCurrency": "CNY", "tokens": 5000000, "cost": 3500.00, "count": 1200 }
  ]
}
```

---

### 5.8 Excel 导出

```
GET /api/admin/export?range=30d
```

**权限**：admin、finance 或 dept_manager

**响应**：Binary Excel 文件（`.xlsx`）

| Sheet 名 | 内容 |
|-----------|------|
| 员工费用汇总 | 姓名、部门、Token、费用、调用次数 |
| 部门费用汇总 | 排名、占比、人均 |
| 渠道费用明细 | 渠道 × 模型 × 费用 |

Header: `Content-Disposition: attachment; filename=token-usage-30d.xlsx`

---

### 5.9 预警记录

```
GET /api/admin/alerts
```

**响应**：最近 100 条预警记录

```json
{
  "alerts": [
    { "id": "al_001", "type": "personal_80", "targetId": "u_051", "message": "您的月度 AI Token 用量已达到限额的 80%", "sentAt": 1718000000 }
  ]
}
```

---

### 5.10 预警配置

```
GET  /api/admin/alerts/settings
PUT  /api/admin/alerts/settings
```

**GET 响应**：

```json
{
  "settings": {
    "personal_threshold": "80",
    "dept_threshold": "80",
    "company_threshold": "90",
    "anomaly_threshold": "5",
    "feishu_webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
    "feishu_notify_enabled": "true",
    "feishu_notify_types": "personal,dept,company,anomaly,balance",
    "notify_recipients_admin": "u_051,u_052",
    "leaderboard_enabled": "true",
    "leaderboard_chat_ids": "oc_xxx"
  }
}
```

**PUT 请求体**：任意子集

```json
{ "personal_threshold": "90", "feishu_notify_enabled": "true" }
```

---

### 5.11 权限管理

```
GET    /api/admin/permissions
POST   /api/admin/permissions
DELETE /api/admin/permissions
PUT    /api/admin/permissions
```

**GET 响应**：

```json
{
  "users": [
    { "id": "u_051", "name": "何广明", "avatar": "...", "role": "admin", "department": "产品部", "departmentId": "od_xxx", "status": "active", "feishuId": "ou_xxx", "roles": ["admin"] }
  ]
}
```

**POST**（添加角色）：`{ "userId": "u_052", "role": "finance" }`

**DELETE**（移除角色）：`{ "userId": "u_052", "role": "finance" }`

> ⚠️ 保护机制：不能移除最后一个 admin。`HARDCODED_ADMIN_IDS` 的 admin 角色受保护。

---

### 5.12 操作日志

```
GET /api/admin/logs
```

**响应**：最近 200 条操作日志

```json
{
  "logs": [
    { "id": "log_001", "adminId": "u_051", "action": "update", "targetType": "quota", "targetId": "u_052", "detail": "{\"scope\":\"personal\",\"monthlyLimit\":500}", "createdAt": 1718000000 }
  ]
}
```

---

### 5.13 审计日志（分页）

```
GET /api/admin/audit-logs?targetType=quota&action=update&limit=50&offset=0
```

**Query 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| targetType | string | — | 筛选目标类型 |
| action | string | — | 筛选操作类型 |
| adminId | string | — | 筛选操作人 |
| limit | number | 50 | 每页条数（最大 200） |
| offset | number | 0 | 偏移量 |

**响应**：

```json
{
  "data": [
    { "id": "log_001", "adminId": "u_051", "action": "update", "targetType": "channel", "targetId": "ch_001", "detail": "...", "createdAt": 1718000000 }
  ],
  "pagination": { "total": 156, "limit": 50, "offset": 0 }
}
```

---

### 5.14 模型用量统计

```
GET /api/admin/models
```

**响应**：当月模型用量，按费用降序

```json
{
  "models": [
    { "model": "deepseek-chat", "tokens": 5000000, "cost": 3500.00, "count": 1200 }
  ]
}
```

---

### 5.15 汇率查询

```
GET  /api/admin/exchange-rate
POST /api/admin/exchange-rate
```

**GET**：返回当前缓存汇率
**POST**：强制刷新（重新从 API 获取）

```json
{ "rate": 7.25, "source": "open.er-api.com" }
```

POST 刷新：

```json
{ "rate": 7.26, "source": "open.er-api.com", "refreshed": true }
```

---

### 5.16 组织架构树

```
GET /api/admin/org-structure
```

**响应**：

```json
{
  "stats": {
    "totalUsers": 150,
    "withCenter": 145,
    "withDept": 140,
    "withGroup": 130,
    "noDeptUsers": 5,
    "noCenterUsers": 3,
    "unassigned": 2,
    "centers": 5,
    "departments": 17,
    "groups": 30
  },
  "tree": [
    {
      "centerName": "产品中心",
      "userCount": 40,
      "departmentCount": 3,
      "departments": [
        {
          "departmentName": "产品部",
          "userCount": 15,
          "groups": [
            { "groupName": "产品一组", "userCount": 8, "users": ["张三", "李四"] }
          ]
        }
      ]
    }
  ],
  "edgeCases": {
    "noDeptUsers": [{ "id": "u_100", "name": "王五", "centerName": "运营中心" }],
    "noCenterUsers": [{ "id": "u_101", "name": "赵六", "department": "技术部" }],
    "unassigned": [{ "id": "u_102", "name": "钱七" }]
  }
}
```

---

### 5.17 敏感字段加密迁移

```
POST /api/admin/migrate/encrypt
```

**说明**：幂等操作，跳过已加密的值。适用于从未配置 `ENCRYPTION_KEY` 到配置后的迁移。

**响应**：

```json
{
  "success": true,
  "message": "加密迁移完成",
  "details": {
    "channels": { "total": 5, "encrypted": 3, "skipped": 2 },
    "users": { "total": 150, "encrypted": 50, "skipped": 100 }
  }
}
```

---

### 5.18 异常检测

```
POST /api/admin/anomaly-check
```

**权限**：admin 或 INTERNAL_API_KEY

**说明**：检测最近 1 小时用量超过 7 天均值 5 倍的用户。

**响应**：

```json
{
  "success": true,
  "checked": 45,
  "anomalyCount": 2,
  "skipped": 0,
  "anomalies": [
    {
      "userName": "张三",
      "department": "产品部",
      "hourlyCost": 500.00,
      "sevenDayAvgHourly": 50.00,
      "multiplier": 10,
      "effectiveThreshold": 5
    }
  ]
}
```

---

### 5.19 员工状态检查

```
POST /api/admin/employee-status-check
```

**权限**：admin 或 INTERNAL_API_KEY

**说明**：比对飞书通讯录，自动将离职员工 status 设为 `disabled`。

**响应**：

```json
{
  "checked": 150,
  "disabled": 3,
  "users": [
    { "id": "u_080", "name": "离职员工A", "reason": "不在飞书通讯录中" }
  ]
}
```

---

### 5.20 排行榜推送

```
POST /api/admin/leaderboard-send
```

**权限**：admin 或 INTERNAL_API_KEY

**响应**：

```json
{ "success": true, "sent": 3, "failed": 0, "chatIds": ["oc_xxx", "oc_yyy", "oc_zzz"] }
```

---

### 5.21 管理员列表

```
GET /api/admin/admins-list
```

**响应**：

```json
{
  "admins": [
    { "id": "u_051", "name": "何广明", "department": "产品部" },
    { "id": "u_052", "name": "陈四华", "department": "运营部" }
  ]
}
```

---

### 5.22 测试预警

#### 测试异常预警

```
POST /api/admin/alerts/test-anomaly
```

**请求体**：`{ "userName": "何广明" }`（可选，默认何广明）

#### 测试飞书通知

```
POST /api/admin/alerts/test-feishu
```

---

## 六、内部接口

> 以下接口通过 `INTERNAL_API_KEY` 认证，仅供定时任务调用。

### 6.1 批量写入用量

```
POST /api/internal/usage
```

**请求体**：

```json
{
  "records": [
    {
      "userId": "u_051",
      "model": "deepseek-chat",
      "inputTokens": 5000,
      "outputTokens": 2000,
      "totalTokens": 7000,
      "cost": 0.35,
      "channelId": "ch_001"
    }
  ]
}
```

**响应**：

```json
{ "success": true, "count": 5 }
```

---

### 6.2 限额预警处理

```
POST /api/internal/quota-alert
```

**请求体**：

```json
{
  "alerts": [
    {
      "type": "personal_80",
      "targetId": "u_051",
      "userId": "u_051",
      "used": 400.00,
      "limit": 500.00,
      "percent": 80
    }
  ]
}
```

**预警类型**：`personal_80` | `personal_100` | `dept_80` | `company_90`

**说明**：自动去重（同一天同一用户/部门的同类预警只发一次），根据 `alert_settings` 配置决定是否发送飞书通知。

**响应**：

```json
{ "success": true, "sent": 3, "skipped": 2 }
```

---

## 七、系统接口

### 7.1 健康检查

```
GET /api/health
```

**权限**：公开

**响应**：

```json
{ "status": "ok", "timestamp": 1718000000, "version": "1.0.0" }
```

---

### 7.2 飞书同步

```
GET  /api/setup/sync-feishu?run=1
POST /api/setup/sync-feishu
```

**权限**：admin 或 INTERNAL_API_KEY

**GET**：
- 无 `run` 参数：返回同步状态 `{ running, startedAt, finishedAt, progress, result, error }`
- `?run=1`：触发后台同步，返回 202。如已在运行返回 409

**POST**：同步执行，适合 CLI 手动触发。

---

### 7.3 数据库重置（⚠️ 危险）

```
POST /api/setup/seed
```

**权限**：admin（生产环境需要 `{ "force": true }`）

**⚠️ 警告**：此操作会**删除整个数据库**并重建，仅用于开发环境。

**响应**：

```json
{
  "success": true,
  "message": "数据库已重置",
  "stats": {
    "users": 153,
    "departments": 17,
    "deptBreakdown": { "产品部": 15, "技术部": 20 },
    "usageLogs": 5000,
    "channels": 5,
    "quotaRules": 10,
    "channels": 5
  }
}
```
