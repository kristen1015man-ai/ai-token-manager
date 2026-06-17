# AI Token Manager — 项目交接文档

> 最后更新：2025-06-08
> 文档目的：让新接手的的人能**快速理解项目全貌**，直接上手开发和运维。

---

## 一、项目概述

**一句话说明**：这是一个企业内部 AI Token 用量管理平台，用于追踪全公司员工使用 AI 模型（DeepSeek、OpenAI、Anthropic、GLM、SiliconFlow、阿里百炼等）的 Token 消耗、费用、限额和预警。

**核心价值**：
- 管理者看到「谁用了多少、花了多少钱、哪个部门最多」
- 员工看到「我这个月用了多少、还剩多少额度」
- 自动预警（超限额、异常用量、余额不足）
- 通过飞书实现登录、通知、员工数据同步

**线上地址**：`https://ai.seapllo.com`

---

## 二、技术架构

```
┌──────────────────────────────────────────────────┐
│                   用户浏览器                       │
│          Next.js 前端（端口 3000）                  │
│   ┌──────────────────────────────────────┐        │
│   │  React 页面 + Recharts 图表          │        │
│   │  Tailwind CSS（Glass 设计系统）       │        │
│   │  飞书 OAuth 登录                     │        │
│   └──────────────┬───────────────────────┘        │
│                  │ 内部 API 调用                    │
│   ┌──────────────▼───────────────────────┐        │
│   │  Next.js API Routes（44 个路由）      │        │
│   │  鉴权(JWT) + 业务逻辑 + SQLite       │        │
│   └──────────────┬───────────────────────┘        │
│                  │ 转发聊天请求                     │
│   ┌──────────────▼───────────────────────┐        │
│   │  Hono Proxy 网关（端口 3001）          │        │
│   │  API Key 鉴权 + 限额检查 + 转发       │        │
│   │  限流(60/min) + 故障转移              │        │
│   └──────────────┬───────────────────────┘        │
│                  │                                │
│   ┌──────────────▼───────────────────────┐        │
│   │  上游 AI 模型服务商                    │        │
│   │  (DeepSeek / OpenAI / Anthropic 等)  │        │
│   └──────────────────────────────────────┘        │
│                                                    │
│   共享层：SQLite 数据库 (data.db)                    │
│   Drizzle ORM + sql.js + AES-256-GCM 加密          │
└──────────────────────────────────────────────────┘
```

### 技术栈

| 层面 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 前端框架 | Next.js | 16.2.6 | App Router, Turbopack |
| UI 框架 | React | 19.2.6 | |
| 样式 | Tailwind CSS | 4.3.0 | CSS 变量主题系统，支持深色模式 |
| 图表 | Recharts | 3.8.1 | |
| 动画 | Framer Motion | 12.40.0 | 排行榜动画 |
| 后端框架 | Hono | - | Proxy 网关独立进程 |
| 数据库 | SQLite (sql.js) | 1.12.0 | 单文件，Docker volume 共享 |
| ORM | Drizzle ORM | 0.44.7 | |
| 认证 | JWT (jose) | 6.2.3 | HS256, 30 天过期 |
| 加密 | AES-256-GCM | Node.js crypto | 敏感字段加密 |
| 飞书 SDK | @larksuiteoapi/node-sdk | 1.66.0 | OAuth + 消息推送 |
| Excel | xlsx | 0.18.5 | 导出报表 |
| 部署 | Docker Compose | - | 两容器 + 共享 volume |

---

## 三、项目目录结构

```
ai-token-manager/
├── web/                          # Next.js 管理后台（主要开发目录）
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/              # 44 个 API 路由
│   │   │   │   ├── auth/         # 飞书 OAuth + JWT 登录/登出
│   │   │   │   ├── admin/        # 管理端 API（20+ 路由）
│   │   │   │   ├── proxy/v1/     # OpenAI 兼容代理端点
│   │   │   │   ├── usage/        # 用户用量查询
│   │   │   │   ├── user/         # API Key 管理
│   │   │   │   ├── internal/     # 内部 API（定时任务用）
│   │   │   │   ├── setup/        # 数据库初始化 + 飞书同步
│   │   │   │   └── health/       # 健康检查
│   │   │   ├── dashboard/        # 前端页面（12 个页面）
│   │   │   ├── login/            # 登录页
│   │   │   ├── globals.css       # 全局样式 + Glass 设计系统
│   │   │   └── layout.tsx
│   │   ├── components/           # 15 个通用组件
│   │   ├── context/              # ThemeContext（深色/浅色模式）
│   │   ├── lib/                  # 29 个工具/服务模块
│   │   │   ├── proxy/            # 代理核心逻辑（限流、缓存、流式）
│   │   │   ├── price-scrapers/   # 各厂商价格爬取
│   │   │   ├── db.ts             # 数据库连接
│   │   │   ├── auth.ts           # JWT 工具
│   │   │   ├── feishu.ts         # 飞书 API 封装
│   │   │   ├── auto-sync.ts      # 定时任务调度器
│   │   │   └── ...               # 其他工具模块
│   │   └── middleware.ts         # 鉴权中间件 + 安全头
│   ├── .env.local                # 环境变量（不入 Git）
│   ├── package.json
│   └── Dockerfile
│
├── proxy/                        # Hono API 网关（独立进程）
│   ├── src/
│   │   ├── index.ts              # 入口
│   │   ├── routes/               # /v1/chat/completions, /v1/models
│   │   ├── middleware/            # 鉴权 + 限额 + 限流
│   │   ├── services/             # 渠道查找 + 请求转发 + 用量记录
│   │   └── utils/                # 汇率 + 定价
│   └── Dockerfile
│
├── shared/                       # 共享代码（web 和 proxy 都用）
│   ├── schema.ts                 # 9 张表的 Drizzle ORM 定义
│   ├── db.ts                     # 数据库连接单例
│   ├── crypto.ts                 # AES-256-GCM 加解密
│   ├── migrate.ts                # 数据库迁移（当前 v4）
│   └── types.ts
│
├── docs/                         # 项目文档
│   ├── HANDOVER.md               # ← 你正在看的这个文件
│   ├── PROJECT-MODULES.md        # 模块详细文档
│   ├── balance-sync.md           # 余额同步说明
│   ├── monitoring.md             # 健康检查配置
│   └── reverse-proxy.md          # Nginx/Caddy 反代配置
│
├── docker-compose.yml            # 生产部署配置
├── send-leaderboard.js           # 独立排行榜推送脚本
├── pnpm-workspace.yaml           # monorepo 工作区
└── data.db                       # SQLite 数据库文件（运行时生成）
```

---

## 四、数据库设计（9 张表）

### 4.1 `users` — 用户表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | 内部 ID |
| feishuId | text (unique) | 飞书 open_id |
| name | text | 姓名 |
| avatar | text | 头像 URL（来自飞书） |
| email | text | 邮箱 |
| department | text | 所属部门（标准化后的） |
| departmentId | text | 飞书部门 ID |
| groupName | text | 飞书小组名 |
| groupId | text | 飞书小组 ID |
| centerName | text | 所属中心 |
| centerId | text | 中心 ID |
| employeeId | text | 工号 |
| apiKey | text (unique) | 用户 API Key（AES 加密存储） |
| apiKeyHash | text | API Key 的 HMAC-SHA256 哈希（用于快速查找） |
| role | text | 角色（逗号分隔：admin,finance,dept_manager,member） |
| status | text | `active` 或 `disabled` |
| monthlyQuota | real | 个人月度限额（默认 200） |
| createdAt | integer | 创建时间戳 |
| updatedAt | integer | 更新时间戳 |

**重要说明**：
- `role` 字段支持多角色，如 `"admin,finance"` 表示既是管理员又是财务
- `status` = `"disabled"` 的用户不出现在排行榜、限额管理、导出中
- `apiKeyHash` 用于代理鉴权时的 O(1) 查找，避免全表解密

### 4.2 `channels` — 渠道表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | 渠道 ID |
| name | text | 渠道名称 |
| baseUrl | text | API 地址 |
| apiKey | text | 渠道密钥（AES 加密） |
| models | text | 支持的模型列表（JSON 数组字符串） |
| priority | integer | 优先级（默认 0，数字越大越优先） |
| status | text | `active` 或 `disabled` |
| currency | text | `CNY` 或 `USD` |
| provider | text | 服务商：deepseek/openai/anthropic/zhipu/siliconflow/alibaba/custom |
| balance | real | 渠道余额 |
| balanceCurrency | text | 余额币种 |
| balanceSyncMode | text | `auto` 或 `manual` |
| balanceSyncedAt | integer | 最后同步时间 |
| balanceAlertThreshold | real | 余额预警阈值 |
| accessKeyId | text | 阿里云 AccessKey ID |
| accessKeySecret | text | 阿里云 AccessKey Secret（AES 加密） |
| createdAt | integer | |

### 4.3 `usage_logs` — 用量日志

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | |
| userId | text FK→users.id | 使用者 |
| model | text | 模型名 |
| inputTokens | integer | 输入 Token |
| outputTokens | integer | 输出 Token |
| totalTokens | integer | 总 Token |
| cost | real | 费用（CNY） |
| channelId | text FK→channels.id | 使用的渠道 |
| createdAt | integer | |

### 4.4 `quota_rules` — 限额规则

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | |
| scope | text | `company` / `department` / `personal` |
| targetId | text | 目标 ID（用户/部门/公司标识） |
| monthlyLimit | real | 月度限额 |
| updatedBy | text | 操作人 |
| updatedAt | integer | |

### 4.5 `model_prices` — 模型定价

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | |
| model | text | 模型名 |
| channelId | text (nullable) | 渠道 ID（null = 全局定价） |
| inputPerMillion | real | 输入单价（每百万 Token） |
| outputPerMillion | real | 输出单价（每百万 Token） |
| cachePerMillion | real | 缓存单价（默认 0） |
| displayName | text | 显示名称 |
| currency | text | 币种 |
| deprecated | boolean | 是否已弃用 |
| syncedAt | integer | 官方价格同步时间（null = 手动设置） |
| updatedBy | text | |
| updatedAt | integer | |
| createdAt | integer | |

### 4.6 其他表

- **`alert_logs`** — 预警记录（类型 + 目标 + 消息 + 发送时间）
- **`alert_settings`** — 预警配置（键值对，如阈值、开关、接收人）
- **`admin_logs`** — 操作审计日志（谁在什么时候做了什么）
- **`sync_blacklist`** — 价格同步黑名单（不自动同步的模型）

### 数据库迁移（当前 v4）

| 版本 | 内容 |
|------|------|
| v1 | channels 表增加 balance/provider/accessKey 列 |
| v2 | model_prices 表增加 currency 列 |
| v3 | users 表增加 api_key_hash 列 + 索引 |
| v4 | usage_logs 增加 (userId, createdAt) 复合索引，users 增加 (departmentId) 索引 |

---

## 五、角色权限体系

### 4 种角色

| 角色 | 可见页面 | 说明 |
|------|---------|------|
| **admin** (管理员) | 全部 12 个页面 | 含渠道管理、价格、限额、预警、日志、权限 |
| **finance** (财务) | 我的用量 + API Key + 全局概览 + 部门分账 | 只读，可导出 Excel |
| **dept_manager** (部门负责人) | 我的用量 + API Key + 部门排行 + 员工排行 + 本部门分账 | 只看本部门数据 |
| **member** (普通员工) | 我的用量 + API Key | 只看自己 |

### 菜单完整列表

| 菜单 | 路径 | 可见角色 |
|------|------|---------|
| 我的用量 | `/dashboard` | 全部 |
| API Key | `/dashboard/key` | 全部 |
| 全局概览 | `/dashboard/admin` | admin, finance |
| 部门排行 | `/dashboard/admin/departments` | admin, dept_manager |
| 员工排行 | `/dashboard/admin/employees` | admin, dept_manager |
| 部门分账 | `/dashboard/admin/billing` | admin, finance, dept_manager |
| 渠道管理 | `/dashboard/admin/channels` | admin |
| 模型价格 | `/dashboard/admin/prices` | admin |
| 限额设置 | `/dashboard/admin/quotas` | admin |
| 预警记录 | `/dashboard/admin/alerts` | admin |
| 操作日志 | `/dashboard/admin/logs` | admin |
| 权限管理 | `/dashboard/admin/permissions` | admin |

### 权限实现方式

1. **前端**：`src/lib/permissions.ts` 的 `getMenuForRole()` 根据角色过滤菜单项
2. **中间件**：`src/middleware.ts` 对 `/api/admin/*` 路由强制 JWT + admin 角色校验
3. **API 层**：每个 admin API 调用 `requireAdmin()` 或 `requireRole()` 二次验证
4. **特殊保护**：`HARDCODED_ADMIN_IDS`（何广明、陈四华）的 admin 角色不会被同步操作降级

---

## 六、核心功能模块

### 6.1 飞书登录（OAuth 2.0）

**流程**：点击「飞书登录」 → 跳转飞书授权 → 回调到 `/api/auth/feishu/callback` → 换取用户信息 → `findOrCreateUser` → 创建 JWT session → 重定向到 Dashboard

**关键文件**：
- `src/app/api/auth/feishu/start.ts` — 生成 CSRF state + 跳转
- `src/app/api/auth/feishu/callback.ts` — 换 token + 取用户信息 + 三级部门分类
- `src/lib/feishu.ts` — 飞书 API 封装
- `src/lib/auth.ts` — JWT 创建/验证

**部门三级分类**：飞书返回用户的部门层级，代码根据名称后缀自动分类为中心(center) → 部门(department) → 组(group)

### 6.2 飞书员工同步

**触发方式**：
1. 服务器启动 30 秒后自动执行
2. 每天 12:00 和 19:00 定时同步
3. 手动触发：`POST /api/setup/sync-feishu`

**同步流程**：
1. 数据库迁移（确保列完整）
2. 从飞书拉取所有部门 → 三级分类
3. 收集所有部门下的用户
4. `findOrCreateUser` upsert（首次自动生成 `sk-emp-xxx` 格式的 API Key）
5. `normalizeAndProtect()` — 部门名规范化 + 管理员角色保护
6. `cleanupDepartedAndSeed()` — 停用已离职员工，清理测试数据

**部门映射逻辑**（`constants.ts`）：
- `GROUP_TO_DEPT` — 小组名 → 部门（如"产品一组" → "产品部"）
- `DEPT_RENAME` — 不规则名修正（如"开发部" → "产品部"）
- `USER_DEPT_OVERRIDE` — 个别用户强制归属

### 6.3 AI 请求代理

**入口**：`POST /api/proxy/v1/chat/completions`

**流程**：
1. `authenticateUser()` — 从 `Authorization: Bearer sk-xxx` 提取 API Key，HMAC 哈希查找用户
2. `checkRateLimit()` — 60 次/分钟滑动窗口
3. `checkQuota()` — 三级限额检查（个人 → 部门 → 公司）
4. `findChannelForModel()` — 按优先级查找可用渠道
5. `proxyChatRequest()` — 转发请求，支持流式(SSE)和非流式
6. 故障转移：主渠道失败自动切备用渠道
7. `recordUsage()` — 批量记录用量（每 10 秒 flush 一次到数据库）

### 6.4 排行榜

**部门排行**（`/dashboard/admin/departments`）：
- 领奖台式 TOP 3 展示（金/银/铜 + 皇冠 + 大理石纹理）
- 点击部门可下钻查看该部门员工明细
- 排序维度：费用 / Token / 人均
- 时间范围：今天 / 7天 / 30天 / 全年

**员工排行**（`/dashboard/admin/employees`）：
- 同样领奖台式 TOP 3
- 支持部门筛选
- 排序维度：费用 / Token / 调用次数

### 6.5 定时任务（auto-sync.ts）

| 任务 | 时间 | 说明 |
|------|------|------|
| 飞书员工同步 | 12:00, 19:00 | 同步通讯录变更 |
| 模型价格同步 | 03:00 | 爬取各厂商官网最新定价 |
| 渠道余额同步 | 04:00 | 查询各渠道余额 + 预警 |
| 异常用量检测 | 每小时 | 检测 1 小时内用量突增（7 天均值的 5 倍） |
| 员工状态检查 | 20:00 | 比对飞书通讯录，自动停用离职人员 |
| 排行榜推送 | 10:00 | 检查是否需要发送排行榜到飞书群 |

**启动时**：服务器启动后 30s 执行飞书同步 + 价格同步，60s 执行余额同步，90s 异常检测，120s 员工状态检查。

### 6.6 预警系统

**预警类型**：
| 类型 | 触发条件 | 通知方式 |
|------|---------|---------|
| personal_80 | 个人用量达限额 80% | 飞书私聊 |
| personal_100 | 个人用量达限额 100% | 飞书私聊 |
| dept_80 | 部门用量达限额 80% | 通知管理员 |
| company_90 | 公司用量达限额 90% | 通知管理员 |
| anomaly | 异常用量突增 | 飞书卡片 |
| balance_low | 渠道余额不足 | 飞书卡片 |
| employee_departed | 员工离职 | 飞书私聊 |
| leaderboard | 排行榜 | 飞书群卡片 |

**通知路由**（`notification-router.ts`）：总开关 → 类型开关 → 接收人解析（按类型可配不同接收人）

### 6.7 费用计算

**三级定价**（优先级从高到低）：
1. 渠道特定价格（`model_prices.channelId` 不为 null）
2. 全局价格（`channelId` 为 null）
3. 硬编码兜底价格

**币种转换**：USD 价格通过汇率 API 自动转 CNY，汇率 24 小时缓存。

**汇率来源**：open.er-api.com → exchangerate-api.com → 硬编码 7.2

### 6.8 Excel 导出

**端点**：`GET /api/admin/export?range=30d`

**导出 3 个 Sheet**：
1. 员工费用汇总（姓名、部门、Token、费用、调用次数）
2. 部门汇总（排名、占比、人均）
3. 渠道 × 模型明细

---

## 七、API 路由清单（44 个端点）

### 公开端点（无需登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/auth/feishu/start` | 发起飞书 OAuth |
| GET | `/api/auth/feishu/callback` | OAuth 回调 |
| GET | `/api/auth/dev-login` | 开发环境快捷登录（生产禁用） |
| POST | `/api/proxy/v1/chat/completions` | AI 代理（Bearer API Key） |
| GET | `/api/proxy/v1/models` | 可用模型列表 |

### 用户端点（JWT 登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/me` | 当前用户信息 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/user/key` | 获取 API Key（脱敏） |
| POST | `/api/user/key` | 重新生成 API Key |
| GET | `/api/usage/summary` | 用量汇总 |
| GET | `/api/usage/chart` | 用量趋势图 |
| GET | `/api/usage/by-model` | 按模型分组 |
| GET | `/api/usage/details` | 明细列表（分页） |

### 管理端点（JWT + admin 角色）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/overview` | 全局概览数据 |
| GET | `/api/admin/models` | 模型用量统计 |
| GET/POST/PUT/DELETE | `/api/admin/channels` | 渠道 CRUD |
| POST | `/api/admin/channels/balance-sync` | 触发余额同步 |
| GET/POST/PUT/DELETE | `/api/admin/prices` | 价格 CRUD |
| POST | `/api/admin/prices/sync` | 触发官方价格同步 |
| GET/POST | `/api/admin/quotas` | 限额管理 |
| GET | `/api/admin/billing/by-model` | 模型维度账单 |
| GET | `/api/admin/billing/by-channel` | 渠道维度账单 |
| GET | `/api/admin/departments` | 部门排行数据 |
| GET | `/api/admin/employees` | 员工排行数据 |
| GET | `/api/admin/org-structure` | 组织架构树 |
| GET | `/api/admin/export` | Excel 导出 |
| GET | `/api/admin/alerts` | 预警记录 |
| GET/PUT | `/api/admin/alerts/settings` | 预警配置 |
| POST | `/api/admin/alerts/test-anomaly` | 测试异常预警 |
| POST | `/api/admin/alerts/test-feishu` | 测试飞书通知 |
| GET/POST/DELETE/PUT | `/api/admin/permissions` | 权限管理 |
| GET | `/api/admin/logs` | 最近 200 条操作日志 |
| GET | `/api/admin/audit-logs` | 审计日志（分页 + 筛选） |
| GET/POST | `/api/admin/exchange-rate` | 汇率查询/刷新 |
| POST | `/api/admin/migrate/encrypt` | 敏感字段加密迁移 |
| GET | `/api/admin/cleanup-preview` | 部门清理预览 |
| POST | `/api/admin/cleanup-execute` | 执行清理 |
| POST | `/api/admin/anomaly-check` | 触发异常检测 |
| POST | `/api/admin/leaderboard-send` | 触发排行榜推送 |
| GET | `/api/admin/admins-list` | 管理员列表（多选用） |
| POST | `/api/admin/employee-status-check` | 员工在职状态检查 |
| GET | `/api/admin/debug` | 调试信息（生产禁用） |

### 内部端点（INTERNAL_API_KEY）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/internal/usage` | 批量写入用量记录 |
| POST | `/api/internal/quota-alert` | 预警处理 |

### 系统端点（admin 或 INTERNAL_API_KEY）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/setup/seed` | **⚠️ 危险操作**：重置数据库 + 种子数据 |
| GET/POST | `/api/setup/sync-feishu` | 触发飞书同步 |

---

## 八、环境变量

### 必须配置

| 变量 | 说明 | 示例 |
|------|------|------|
| `JWT_SECRET` | JWT 签名密钥（HS256），生产若为默认值会拒绝所有认证 | `openssl rand -hex 32` 生成 |
| `FEISHU_APP_ID` | 飞书应用 ID | `cli_xxxxx` |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | |
| `FEISHU_REDIRECT_URI` | OAuth 回调地址 | `https://ai.seapllo.com/api/auth/feishu/callback` |
| `NEXT_PUBLIC_FEISHU_APP_ID` | 浏览器端飞书 App ID（同上） | `cli_xxxxx` |
| `NEXT_PUBLIC_FEISHU_REDIRECT_URI` | 浏览器端回调地址（同上） | |
| `INTERNAL_API_KEY` | 内部服务间通信密钥，proxy→web 和定时任务用 | `openssl rand -hex 24` 生成 |
| `DATABASE_URL` | 数据库路径 | `../data.db`（本地）或 `/data/data.db`（Docker） |

### 重要配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ENCRYPTION_KEY` | AES-256-GCM 加密密钥（64 位 hex），加密 API Key 和 AccessKey Secret | 无 = 明文存储（不安全） |
| `ADMIN_IDS` | 管理员飞书 open_id（逗号分隔），同步时强制保持 admin 角色不被降级 | 空 |
| `ADMIN_EMAILS` | 管理员邮箱（逗号分隔），首次登录自动授 admin | 空 |
| `WEB_URL` | Web 服务地址，proxy→web 内部调用用 | `http://web:3000`（Docker） |
| `PROXY_PORT` | 代理网关端口 | `3001` |
| `WEB_PORT` | 管理后台端口 | `3000` |
| `PORT` | Web 服务端口（fallback） | `3000` |
| `CORS_ALLOWED_ORIGINS` | CORS 跨域白名单（逗号分隔） | `http://localhost:3000` |

### 可选 / 平台特定

| 变量 | 说明 | 场景 |
|------|------|------|
| `RAILWAY_VOLUME_MOUNT_PATH` | Railway 平台卷挂载路径 | Railway 部署时自动设置 |
| `NODE_ENV` | 运行环境 | `production` 时启用 HSTS 等安全头 |

---

## 九、部署

### 本地开发

```bash
cd ai-token-manager
pnpm install

# web 服务
cd web
pnpm dev    # 启动在 http://localhost:3000

# proxy 网关（另一个终端）
cd proxy
pnpm dev    # 启动在 http://localhost:3001
```

### Docker 部署

```bash
# 1. 创建 .env 文件（填入真实配置）
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build

# 3. 查看日志
docker compose logs -f
```

**Docker 架构**：
- `proxy` 容器：端口 3001，处理 AI 请求转发
- `web` 容器：端口 3000，管理后台
- 共享 `app-data` volume 存放 `data.db`

### Nginx 反向代理

详见 `docs/reverse-proxy.md`，关键配置：
- SSE 流式响应需要关闭 `proxy_buffering`
- 超时设置 300 秒（AI 推理可能很慢）

---

## 十、开发注意事项

### 10.1 ⚠️ 危险操作

- **`POST /api/setup/seed`** 会调用 `resetDb()` **删除整个数据库文件**，然后重建。**绝对不要在生产环境调用**。
- 飞书同步（`sync-feishu`）是安全的，只会 upsert 用户数据，不会删除。

### 10.2 安全机制

| 机制 | 说明 |
|------|------|
| API Key 存储用 AES-256-GCM 加密 | `ENCRYPTION_KEY` 必须配置 |
| API Key 查找用 HMAC-SHA256 哈希 | 避免全表解密，O(1) 查找 |
| JWT 签名 | HS256，30 天过期 |
| CSRF 保护 | 飞书 OAuth 使用 HttpOnly cookie + timingSafeEqual 验证 state |
| 安全响应头 | CSP / X-Frame-Options / HSTS / nosniff |
| 管理员保护 | `HARDCODED_ADMIN_IDS` 不被同步降级 |

### 10.3 数据库注意事项

- SQLite 单文件，Docker 环境通过 volume 共享
- `saveDb()` 有 2 秒防抖，`resetDb()` 会直接删除文件
- 所有时间字段用 Unix 时间戳（integer），不是 ISO 字符串
- 用户状态 `status` 字段：查询排行榜、限额、导出时都要 `WHERE status = 'active'`

### 10.4 前端开发约定

- **Glass 设计系统**：CSS 变量 `--glass-bg`、`--glass-border`、`--text-primary` 等
- **深色模式**：`[data-theme="dark"]` 选择器覆盖，通过 ThemeContext 切换
- **部门图标**：圆形字母缩写（`getMonogram`），hash 取色，不用图片
- **用户头像**：Avatar 组件，有飞书头像用飞书的，没有显示姓名首字
- **排序切换**：排行榜页面的 `sortBy` 控制排序和显示，用 `fmtPrimary`/`fmtSecondary` 动态格式化

### 10.5 已知问题和历史教训

1. **种子操作会清除数据**：之前误操作导致全量数据丢失。seed 端点已加 admin 权限保护。
2. **disabled 用户**：数据库中有 142 个 status='disabled' 的种子用户（无头像），查询时必须加 status 过滤。
3. **部门名不一致**：飞书返回的部门名可能不规范（如"开发部"应为"产品部"），通过 `constants.ts` 的映射表修正。

---

## 十一、前端页面一览

| 页面 | 路径 | 功能 |
|------|------|------|
| 登录 | `/login` | 飞书 OAuth 登录，玻璃态设计 + 动画背景 |
| 我的用量 | `/dashboard` | 费用/Token/调用汇总 + 趋势图 + 模型分布 + 限额进度 |
| API Key | `/dashboard/key` | 查看/重新生成 API Key + 代理地址 |
| 全局概览 | `/dashboard/admin` | 统计卡片 + 费用/Token趋势 + 渠道饼图 + 模型表 + 余额概览 |
| 部门排行 | `/dashboard/admin/departments` | TOP 3 领奖台 + 完整排名 + 下钻员工明细 |
| 员工排行 | `/dashboard/admin/employees` | TOP 3 领奖台 + 完整排名 + 部门筛选 |
| 部门分账 | `/dashboard/admin/billing` | 部门饼图 + 柱状图 + 模型表 + 明细表 + 导出 |
| 渠道管理 | `/dashboard/admin/channels` | 渠道 CRUD + 余额同步 + 阿里云 AK/SK |
| 模型价格 | `/dashboard/admin/prices` | 价格 CRUD + 双币种显示 + 官方同步 |
| 限额设置 | `/dashboard/admin/quotas` | 公司限额 + 个人限额（批量/单个编辑） |
| 预警记录 | `/dashboard/admin/alerts` | 阈值设置 + 飞书通知配置 + 预警历史 |
| 操作日志 | `/dashboard/admin/logs` | 审计日志查询（按类型筛选 + 分页） |
| 权限管理 | `/dashboard/admin/permissions` | 三组角色管理（管理员/财务/部门负责人） |

---

## 十二、快速上手指南

### 第一次启动

```bash
# 1. 安装依赖
cd ai-token-manager
pnpm install

# 2. 配置环境变量
cd web
cp .env.example .env.local
# 编辑 .env.local，填入飞书凭证和 JWT_SECRET

# 3. 启动 web
pnpm dev

# 4. 访问 http://localhost:3000
# 开发环境可访问 /api/auth/dev-login 快捷登录
```

### 常用开发命令

```bash
# 类型检查
cd web && pnpm tsc --noEmit

# 构建
cd web && pnpm build

# Docker 构建
docker compose up -d --build
```

### 常见问题

**Q: 数据库在哪？**
A: 本地开发在 `ai-token-manager/data.db`（web 目录的上一级），Docker 环境在 volume `/data/data.db`。

**Q: 如何添加新的管理员？**
A: 在 `.env.local` 的 `ADMIN_IDS` 中添加飞书 open_id（逗号分隔），或在权限管理页面手动赋角色。`HARDCODED_ADMIN_IDS`（代码中）保护的管理员不会被同步降级。

**Q: 如何查看所有定时任务状态？**
A: 查看服务器日志，搜索 `[AutoSync]` 前缀的输出。

**Q: 如何手动触发飞书同步？**
A: 调用 `POST /api/setup/sync-feishu`（需 admin 或 INTERNAL_API_KEY）。

**Q: 排行榜数据不准？**
A: 检查是否有 `status = 'disabled'` 的用户混入查询。所有排行、限额、导出 API 都应该只查 active 用户。

---

## 十三、文档索引

| 文档 | 路径 | 内容 |
|------|------|------|
| 项目交接 | `docs/HANDOVER.md` | 你正在看的这个 |
| 架构设计 | `docs/ARCHITECTURE.md` | Mermaid 图：系统总览、认证流程、数据管线、定时任务、权限矩阵、预警、Docker、安全 |
| API 接口 | `docs/API.md` | 44+ 接口的详细文档：参数、响应示例、错误码、鉴权要求 |
| 模块详情 | `docs/PROJECT-MODULES.md` | 数据库设计 + API + 页面详细说明 |
| 余额同步 | `docs/balance-sync.md` | 渠道余额自动同步机制 |
| 健康检查 | `docs/monitoring.md` | 健康检查端点 + 监控集成 |
| 反向代理 | `docs/reverse-proxy.md` | Nginx/Caddy 配置指南 |
| Proxy 内部机制 | `docs/PROXY-INTERNALS.md` | 网关内部机制：缓存策略、限流算法、限额检查、用量上报、费用计算、汇率获取 |
| 数据库 Schema | `docs/DATABASE-SCHEMA.md` | 全部 9 张表的逐列文档：类型、约束、索引、加密字段、迁移历史 |
