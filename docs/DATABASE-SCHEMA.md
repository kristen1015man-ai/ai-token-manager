# AI Token 管家 — 数据库 Schema 参考

> 最后更新：2025-06-08
> 数据库：SQLite（sql.js），ORM：Drizzle
> 文件位置：`shared/schema.ts`（表定义）、`shared/migrate.ts`（迁移）
> 当前 Schema 版本：**4**

---

## 概述

共 9 张业务表 + 1 张版本管理表，存储在项目根目录 `data.db` 文件中。

| 表名 | 用途 | 关键关系 |
|------|------|---------|
| `users` | 用户信息 + API Key | 被 usage_logs、admin_logs 引用 |
| `channels` | 上游 AI 渠道配置 | 被 usage_logs 引用 |
| `usage_logs` | AI 请求用量记录 | → users、→ channels |
| `quota_rules` | 限额规则（个人/部门/公司） | targetId 关联 user 或 department |
| `model_prices` | 模型定价（渠道级/全局） | channelId → channels |
| `alert_logs` | 预警通知记录 | — |
| `alert_settings` | 预警配置（KV 结构） | — |
| `sync_blacklist` | 模型同步黑名单 | — |
| `admin_logs` | 管理操作审计日志 | → users |
| `_schema_version` | 迁移版本管理 | 内部表 |

---

## 1. users — 用户表

**存储所有系统用户，由飞书同步创建或手动创建。**

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | TEXT | **PRIMARY KEY** | — | UUID，由 `randomBytes(16).toString("hex")` 生成 |
| `feishu_id` | TEXT | NOT NULL, UNIQUE | — | 飞书用户 open_id（如 `ou_xxxxx`） |
| `name` | TEXT | NOT NULL | — | 用户姓名 |
| `avatar` | TEXT | — | NULL | 飞书头像 URL |
| `email` | TEXT | — | NULL | 飞书邮箱 |
| `department` | TEXT | — | NULL | 部门名称（文本，用于展示） |
| `department_id` | TEXT | — | NULL | 部门 ID（飞书 department_id） |
| `group_name` | TEXT | — | NULL | 小组名称 |
| `group_id` | TEXT | — | NULL | 小组 ID |
| `center_name` | TEXT | — | NULL | 中心名称 |
| `center_id` | TEXT | — | NULL | 中心 ID |
| `employee_id` | TEXT | — | NULL | 工号 |
| `api_key` | TEXT | NOT NULL, UNIQUE | — | AES-256-GCM 加密存储的 API Key（格式 `sk-emp-xxx`） |
| `api_key_hash` | TEXT | — | NULL | HMAC-SHA256 哈希，用于 SQL WHERE 精确匹配查找 |
| `role` | TEXT | NOT NULL | `'member'` | 角色字符串，逗号分隔多角色（admin,finance,dept_manager,member） |
| `status` | TEXT | NOT NULL | `'active'` | `active` 或 `disabled` |
| `monthly_quota` | REAL | — | 200 | 个人月度限额（CNY），Proxy 限额检查使用 |
| `created_at` | INTEGER | NOT NULL | `unixepoch()` | Unix 时间戳（秒） |
| `updated_at` | INTEGER | NOT NULL | `unixepoch()` | Unix 时间戳（秒） |

### 索引

| 索引名 | 列 | 类型 | 用途 |
|--------|-----|------|------|
| `idx_users_api_key` | `api_key` | 普通索引 | 旧版 API Key 查找（已弃用，保留兼容） |
| `idx_users_api_key_hash` | `api_key_hash` | 普通索引 | HMAC 哈希查找（当前主要鉴权路径） |
| `idx_users_feishu_id` | `feishu_id` | 普通索引 | 飞书 OAuth 回调查找 |
| `idx_users_department_id` | `department_id` | 普通索引 | 部门限额查询 |

### 敏感字段说明

- **`api_key`**：AES-256-GCM 加密存储。密钥来自 `ENCRYPTION_KEY` 环境变量。
- **`api_key_hash`**：HMAC-SHA256 不可逆哈希。用于 SQL WHERE 精确匹配（避免全表扫描解密）。

---

## 2. channels — 上游渠道表

**存储 AI 服务商渠道配置（如 DeepSeek、OpenAI、Anthropic 等）。**

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | TEXT | **PRIMARY KEY** | — | UUID |
| `name` | TEXT | NOT NULL | — | 渠道显示名称（如"DeepSeek 官方"） |
| `base_url` | TEXT | NOT NULL | — | 上游 API Base URL（如 `https://api.deepseek.com`） |
| `api_key` | TEXT | NOT NULL | — | 上游 API Key（AES-256-GCM 加密存储） |
| `models` | TEXT | NOT NULL | `'[]'` | JSON 数组，支持的模型名列表（如 `["deepseek-chat","deepseek-reasoner"]`）；支持通配符 `["*"]` |
| `priority` | INTEGER | NOT NULL | 0 | 优先级（ASC 排序，数字越小优先级越高） |
| `status` | TEXT | NOT NULL | `'active'` | `active` 或 `disabled` |
| `currency` | TEXT | NOT NULL | `'CNY'` | 渠道计费币种 `CNY` 或 `USD` |
| `provider` | TEXT | — | NULL | 供应商标识：`deepseek` / `glm` / `openai` / `anthropic` / `siliconflow` |
| `balance` | REAL | — | NULL | 当前余额（NULL = 从未同步） |
| `balance_currency` | TEXT | — | NULL | 余额币种 `CNY` 或 `USD` |
| `balance_sync_mode` | TEXT | — | NULL | `auto`（自动同步）/ `manual`（手动），NULL = 按供应商自动判断 |
| `balance_synced_at` | INTEGER | — | NULL | 最后余额同步时间（Unix 时间戳） |
| `balance_alert_threshold` | REAL | — | NULL | 单渠道余额预警阈值（NULL = 使用全局默认） |
| `access_key_id` | TEXT | — | NULL | 阿里云 AccessKey ID（用于 BSS 余额查询） |
| `access_key_secret` | TEXT | — | NULL | 阿里云 AccessKey Secret（AES-256-GCM 加密存储） |
| `created_at` | INTEGER | NOT NULL | `unixepoch()` | 创建时间 |

### 敏感字段

- **`api_key`**：上游 API Key，AES-256-GCM 加密
- **`access_key_secret`**：阿里云密钥，AES-256-GCM 加密

---

## 3. usage_logs — 用量记录表

**每次 AI 请求完成后异步写入，由 Proxy 网关批量上报。**

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | TEXT | **PRIMARY KEY** | — | 16 位 hex 随机 ID（`randomBytes(8).toString("hex")`） |
| `user_id` | TEXT | NOT NULL, **FK** → users.id | — | 发起请求的用户 ID |
| `model` | TEXT | NOT NULL | — | 请求的模型名（如 `deepseek-chat`） |
| `input_tokens` | INTEGER | NOT NULL | 0 | 输入 Token 数 |
| `output_tokens` | INTEGER | NOT NULL | 0 | 输出 Token 数 |
| `total_tokens` | INTEGER | NOT NULL | 0 | 总 Token 数（input + output + cache） |
| `cost` | REAL | NOT NULL | 0 | 费用（CNY），由 pricing.ts 三级定价计算 |
| `channel_id` | TEXT | NOT NULL, **FK** → channels.id | — | 实际处理请求的渠道 ID |
| `created_at` | INTEGER | NOT NULL | `unixepoch()` | 请求完成时间 |

### 索引

| 索引名 | 列 | 类型 | 用途 |
|--------|-----|------|------|
| `idx_usage_logs_user_id` | `user_id` | 普通索引 | 按用户查用量 |
| `idx_usage_logs_created_at` | `created_at` | 普通索引 | 按时间范围查询 |
| `idx_usage_logs_model` | `model` | 普通索引 | 按模型统计 |
| `idx_usage_logs_user_created` | `(user_id, created_at)` | 复合索引 | 个人月度用量汇总（限额查询优化，v4 新增） |

### 写入方式

Proxy 网关通过内存缓冲区批量上报：
- 缓冲区满 50 条或每 2 秒 flush 一次
- `POST /api/internal/usage`（Bearer `INTERNAL_API_KEY`）
- 失败不重试，计入 `lostRecordCount`
- `totalTokens === 0` 的请求静默跳过

---

## 4. quota_rules — 限额规则表

**存储三级限额配置：个人、部门、公司。**

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | TEXT | **PRIMARY KEY** | — | UUID |
| `scope` | TEXT | NOT NULL | — | `company` / `department` / `personal` |
| `target_id` | TEXT | NOT NULL | — | scope=personal → userId；scope=department → departmentId；scope=company → `"all"` |
| `monthly_limit` | REAL | NOT NULL | — | 月度限额（CNY） |
| `updated_by` | TEXT | — | NULL | 最后修改者 userId |
| `updated_at` | INTEGER | NOT NULL | `unixepoch()` | 最后修改时间 |

### 索引

| 索引名 | 列 | 类型 | 用途 |
|--------|-----|------|------|
| `idx_quota_rules_scope_target` | `(scope, target_id)` | 复合索引 | Proxy 限额检查快速定位规则 |

### 检查优先级

Proxy 按以下顺序检查，任一级超限即拒绝：

1. **personal** — `scope="personal" AND target_id=userId`
2. **department** — `scope="department" AND target_id=departmentId`（仅当用户有 departmentId）
3. **company** — `scope="company" AND target_id="all"`

---

## 5. model_prices — 模型价格表

**存储每个模型的计费价格，支持渠道级和全局级定价。**

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | TEXT | **PRIMARY KEY** | — | UUID |
| `model` | TEXT | NOT NULL | — | 模型名（如 `deepseek-chat`） |
| `channel_id` | TEXT | — | NULL | 渠道 ID（NULL = 全局价格，非 NULL = 渠道特定价格） |
| `input_per_million` | REAL | NOT NULL | — | 输入价格（每百万 Token） |
| `output_per_million` | REAL | NOT NULL | — | 输出价格（每百万 Token） |
| `cache_per_million` | REAL | NOT NULL | 0 | 缓存命中价格（每百万 Token） |
| `display_name` | TEXT | — | NULL | 前端展示名（如 "DeepSeek Chat"） |
| `currency` | TEXT | NOT NULL | `'CNY'` | 价格币种 `CNY` 或 `USD`（v2 迁移新增） |
| `deprecated` | INTEGER | NOT NULL | 0 | 是否弃用（布尔，0/1） |
| `synced_at` | INTEGER | — | NULL | 最后从供应商同步的时间 |
| `updated_by` | TEXT | — | NULL | 最后手动修改者 |
| `updated_at` | INTEGER | NOT NULL | `unixepoch()` | 最后更新时间 |
| `created_at` | INTEGER | NOT NULL | `unixepoch()` | 创建时间 |

### 索引

| 索引名 | 列 | 类型 | 用途 |
|--------|-----|------|------|
| `idx_mp_channel_model` | `(channel_id, model)` | **UNIQUE** | 渠道+模型组合唯一，防止重复定价 |
| `idx_mp_model` | `model` | 普通索引 | 按模型名查找全局价格 |

### 定价查找优先级

Proxy 的 `pricing.ts` 按以下顺序查找：

1. **渠道特定** — `channelId = "xxx" AND model = "deepseek-chat"`
2. **全局** — `channelId IS NULL AND model = "deepseek-chat"`
3. **硬编码兜底** — 直接使用 `deepseek-chat` 的内置价格（Input: 1.0, Output: 2.0 CNY/1M）

---

## 6. alert_logs — 预警记录表

**记录所有已发送的预警通知。**

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | TEXT | **PRIMARY KEY** | — | UUID |
| `type` | TEXT | NOT NULL | — | 预警类型（见下表） |
| `target_id` | TEXT | NOT NULL | — | 预警目标（userId / departmentId / channelId / "all"） |
| `message` | TEXT | NOT NULL | — | 预警消息内容 |
| `sent_at` | INTEGER | NOT NULL | `unixepoch()` | 发送时间 |

### 预警类型枚举

| type | 含义 | target_id |
|------|------|-----------|
| `personal_80` | 个人用量达 80% | userId |
| `personal_100` | 个人用量达 100% | userId |
| `dept_80` | 部门用量达 80% | departmentId |
| `company_90` | 公司用量达 90% | `"all"` |
| `anomaly` | 异常用量检测 | userId |
| `balance_low` | 渠道余额不足 | channelId |
| `employee_departed` | 员工离职 | userId |
| `leaderboard` | 排行榜推送 | `"all"` |

---

## 7. alert_settings — 预警设置表

**KV 结构存储预警配置。**

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `key` | TEXT | **PRIMARY KEY** | — | 配置项名称 |
| `value` | TEXT | NOT NULL | — | 配置项值（JSON 字符串或简单文本） |
| `updated_at` | INTEGER | NOT NULL | `unixepoch()` | 最后更新时间 |

### 常用配置项

| key | value 示例 | 说明 |
|-----|-----------|------|
| `personal_threshold` | `"80"` | 个人预警阈值（%） |
| `feishu_notify_enabled` | `"true"` | 飞书通知开关 |
| `notify_recipients_*` | `"ou_xxx,ou_yyy"` | 通知接收人（按类型） |

---

## 8. sync_blacklist — 同步黑名单

**防止被手动删除的模型在下次同步时被恢复。使用复合主键（无 ROWID 优化）。**

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model` | TEXT | **PK (复合)** | — | 模型名 |
| `channel_id` | TEXT | **PK (复合)** | — | 渠道 ID（NULL = 全局黑名单，非 NULL = 渠道级） |
| `created_at` | INTEGER | NOT NULL | `unixepoch()` | 加入黑名单时间 |

> 表使用 `WITHOUT ROWID` 优化，复合主键 `(model, channel_id)`。

---

## 9. admin_logs — 管理操作日志

**记录所有管理操作的审计日志。**

| 列名 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | TEXT | **PRIMARY KEY** | — | UUID |
| `admin_id` | TEXT | NOT NULL, **FK** → users.id | — | 执行操作的管理员 ID |
| `action` | TEXT | NOT NULL | — | 操作类型（如 `create`、`update`、`delete`、`sync`） |
| `target_type` | TEXT | NOT NULL | — | 目标类型（如 `channel`、`price`、`quota`、`user`） |
| `target_id` | TEXT | NOT NULL | — | 目标对象 ID |
| `detail` | TEXT | — | NULL | 操作详情（JSON 对象） |
| `created_at` | INTEGER | NOT NULL | `unixepoch()` | 操作时间 |

---

## 10. _schema_version — 迁移版本表（内部）

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `version` | INTEGER | **PRIMARY KEY** | 已执行的迁移版本号 |
| `applied_at` | INTEGER | NOT NULL | 迁移执行时间 |

### 迁移历史

| 版本 | 内容 | 影响表 |
|------|------|--------|
| v0 (建表) | 创建所有基础表 + 索引 | 全部 |
| v1 | 添加余额/供应商/AccessKey 字段 | channels |
| v2 | 添加币种字段 | model_prices |
| v3 | 添加 HMAC 哈希字段 + 索引 | users |
| v4 | 添加复合索引（限额查询优化） | usage_logs, users |

---

## ER 关系图

```
users (id) ←──── usage_logs.user_id
    ↑               usage_logs.channel_id ────→ channels (id)
    │
    ├── admin_logs.admin_id
    │
    ├── quota_rules.target_id (scope=personal)
    │
    ├── alert_logs.target_id (type=personal_*)
    │
    └──[department_id]── quota_rules.target_id (scope=department)

channels (id) ←── model_prices.channel_id
                 sync_blacklist.channel_id

alert_settings  (独立 KV 表，无外键)
```

---

## 加密字段汇总

以下字段使用 AES-256-GCM 加密存储，密钥来自 `ENCRYPTION_KEY` 环境变量：

| 表 | 字段 | 说明 |
|-----|------|------|
| users | `api_key` | 用户 API Key（`sk-emp-xxx`） |
| channels | `api_key` | 上游渠道 API Key |
| channels | `access_key_secret` | 阿里云 AccessKey Secret |

### 哈希字段

| 表 | 字段 | 算法 | 用途 |
|-----|------|------|------|
| users | `api_key_hash` | HMAC-SHA256 | 不可逆哈希索引，Proxy 鉴权时 SQL WHERE 精确匹配 |
