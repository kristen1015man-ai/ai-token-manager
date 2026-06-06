# AI Token 管家

> 公司级 AI API 代理网关 + 管理后台
> 让全公司共用一个 API Key，同时精确追踪每个人的用量和费用。

## 🎯 解决什么问题

| 痛点 | 解决方案 |
|------|---------|
| 全公司共用一个 API Key，无法区分谁用了多少 | 每人分配专属 Key，代理网关自动识别身份并记录用量 |
| 无法按部门分账 | 从飞书同步部门信息，按部门汇总费用 |
| 无法防止滥用 | 按人/部门/公司三级限额，超限自动拦截 |
| 手动统计费用太麻烦 | 自动记录每次调用的 Token 数和费用，一键导出报表 |
| 渠道余额不清楚，突然欠费停服 | 自动同步余额 + 不足时飞书告警 |
| 异常用量无法及时发现 | 每小时异常检测，突增自动飞书通知 |

## 🏗️ 系统架构

```
员工代码/工具
    ↓ 请求（带专属 sk-xxx Key）
API 代理网关（认证 → 限频 → 限额 → 转发 → 记录）
    ↓
DeepSeek / Claude / 其他模型 API

管理后台（飞书登录 → 查看用量 → 管理限额 → 导出报表）
```

### Monorepo 结构

```
ai-token-manager/
├── proxy/                    # API 代理网关（Hono，端口 3001）
├── web/                      # 管理后台（Next.js 16，端口 3000）
├── shared/                   # 共享 Drizzle Schema + TypeScript 类型
├── nginx/                    # 反向代理配置
├── docker-compose.yml
├── .env.production.example
└── README.md
```

- **proxy/**：Hono API 网关，负责认证、限频、限额、转发、用量记录
- **web/**：Next.js 16 管理后台，含飞书 OAuth 登录、仪表盘、渠道管理、告警设置
- **shared/**：Drizzle ORM 表定义（sql.js / WASM SQLite），前后端共用类型

## 📋 功能清单

### 员工功能
- ✅ 飞书一键登录，自动获取专属 API Key
- ✅ 今日/本月用量概览（Token 数、费用、剩余额度）
- ✅ 分时段用量图表（小时/天/周/月）
- ✅ 使用明细列表（分页）
- ✅ API Key 管理（查看/复制/重置）

### 管理员功能
- ✅ 全局概览（公司总费用、活跃用户、趋势图）
- ✅ 部门排行 + 费用对比
- ✅ 员工排行 Top 20（支持按部门筛选）
- ✅ 部门分账明细 + CSV 导出
- ✅ 模型分布饼图
- ✅ 三级限额设置（公司/部门/个人）
- ✅ 上游渠道管理（添加/编辑/禁用/故障切换）
- ✅ 渠道余额同步（DeepSeek/硅基流动/阿里千问 自动，其他手动）
- ✅ 余额不足告警（页面标签 + 飞书 Webhook 卡片）
- ✅ 异常用量检测（1 小时花费超过 7 天均值 5 倍 → 飞书告警）
- ✅ 模型价格自动同步（实时汇率 USD→CNY）
- ✅ 飞书机器人预警通知（个人/部门/公司三级告警）
- ✅ 管理操作审计日志

### 代理网关
- ✅ OpenAI 兼容接口（`/v1/chat/completions`）
- ✅ SSE 流式响应（打字机效果）
- ✅ 渠道故障自动切换
- ✅ 每次调用自动记录 Token 和费用
- ✅ API Key 认证 + 请求限频 + 限额拦截

## 🚀 快速开始

### 环境要求

- **Docker** + **Docker Compose**
- **飞书企业版**（需创建自建应用）

### 第一步：飞书应用配置

1. 登录 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 在「权限管理」中开通以下权限：
   - 获取用户基本信息（姓名、头像）
   - 获取用户邮箱
   - 获取部门信息
4. 在「安全设置」中添加回调地址：
   ```
   https://ai.yourcompany.com/api/auth/feishu/callback
   ```
5. 记录 **App ID** 和 **App Secret**

### 第二步：配置环境变量

```bash
# 复制环境变量模板
cp .env.production.example .env

# 编辑 .env，填入实际配置
```

必填项说明：

| 变量 | 说明 | 示例 |
|------|------|------|
| `FEISHU_APP_ID` | 飞书应用 ID | `cli_xxxx` |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | `xxxx` |
| `FEISHU_REDIRECT_URI` | OAuth 回调地址 | `https://ai.yourcompany.com/api/auth/feishu/callback` |
| `JWT_SECRET` | JWT 签名密钥（≥32 位随机字符串） | `openssl rand -hex 32` 生成 |
| `ADMIN_EMAILS` | 管理员邮箱（逗号分隔） | `admin@company.com,it@company.com` |

### 第三步：启动服务

```bash
# 构建并启动
docker compose up -d --build

# 查看日志
docker compose logs -f
```

服务启动后：
- 管理后台：`http://localhost:3000`
- API 代理：`http://localhost:3001`

### 第四步：初始化

1. 用管理员邮箱对应的飞书账号登录管理后台
2. 进入「渠道管理」，添加上游 API 渠道：
   - 名称：DeepSeek 官方
   - Base URL：`https://api.deepseek.com`
   - API Key：你的 DeepSeek API Key
   - 模型列表：`["deepseek-chat", "deepseek-reasoner"]`
3. 进入「限额设置」，配置公司月度预算
4. 完成！

### 第五步：员工使用

员工只需要两步：

```bash
# 1. 打开管理后台，飞书登录，复制专属 Key

# 2. 设置环境变量
export OPENAI_API_KEY=sk-xxx
export OPENAI_BASE_URL=https://ai.yourcompany.com/v1

# 完成！所有兼容 OpenAI 的工具自动走公司代理
```

## 📁 项目结构

```
ai-token-manager/
├── proxy/                    # API 代理网关 (Hono + Node.js)
│   ├── src/
│   │   ├── index.ts          # 入口，注册路由和中间件
│   │   ├── middleware/        # 认证、限频、限额中间件
│   │   ├── routes/            # /v1/chat/completions, /v1/models
│   │   ├── services/          # 代理转发、用量记录、渠道路由
│   │   └── utils/             # 模型单价表
│   └── Dockerfile
├── web/                      # 管理后台 (Next.js 16 + Turbopack)
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/           # 后端 API 路由
│   │   │   │   ├── admin/     # 管理员 API（渠道/限额/告警/余额同步）
│   │   │   │   ├── auth/      # 飞书 OAuth 登录
│   │   │   │   └── setup/     # 初始化 + 飞书数据同步
│   │   │   ├── dashboard/     # 仪表盘页面
│   │   │   └── login/         # 飞书登录页
│   │   ├── components/        # UI 组件
│   │   └── lib/               # 工具库
│   │       ├── auto-sync.ts       # 定时调度器
│   │       ├── balance-sync.ts    # 渠道余额同步
│   │       ├── anomaly-detect.ts  # 异常用量检测
│   │       ├── db.ts              # 数据库连接（sql.js）
│   │       ├── feishu-bot.ts      # 飞书消息推送
│   │       └── api-handler.ts     # 统一错误处理
│   └── Dockerfile
├── shared/                   # 共享类型和数据库 Schema
│   ├── schema.ts             # Drizzle ORM 表定义（9 张表）
│   ├── types.ts              # TypeScript 类型
│   └── db.ts                 # 数据库连接工具
├── nginx/                    # Nginx 反向代理配置
├── docker-compose.yml
├── .env.production.example
└── README.md
```

## ⏰ 定时任务

系统启动后自动运行以下定时任务（无需外部 cron）：

| 任务 | 时间 | 说明 |
|------|------|------|
| 飞书员工同步 | 每天 12:00、19:00 | 同步入职/离职/部门变动 |
| 模型价格同步 | 每天 03:00 | 从上游获取最新价格 + 汇率 |
| 渠道余额同步 | 每天 04:00 | DeepSeek/硅基流动/阿里千问余额 |
| 异常用量检测 | 每小时整点 | 1 小时花费超 7 天均值 5 倍 → 告警 |
| 启动初始同步 | 启动后 30-90 秒 | 价格、余额、异常检测各跑一次 |

## 📡 API 端点一览

### 代理网关（proxy，端口 3001）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/chat/completions` | OpenAI 兼容聊天接口（支持 SSE 流式） |
| GET | `/v1/models` | 可用模型列表 |
| GET | `/health` | 健康检查 |

### 管理后台（web，端口 3000）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/feishu/callback` | 飞书 OAuth 回调 |
| GET | `/api/admin/overview` | 全局概览数据 |
| GET/PUT | `/api/admin/channels` | 渠道管理 |
| POST | `/api/admin/channels/balance-sync` | 手动触发余额同步 |
| POST | `/api/admin/prices/sync` | 手动触发价格同步 |
| POST | `/api/admin/anomaly-check` | 手动触发异常检测 |
| GET/PUT | `/api/admin/alerts/settings` | 告警设置 |
| GET/PUT | `/api/admin/quota` | 限额管理 |
| GET | `/api/admin/audit-logs` | 审计日志 |
| POST | `/api/setup/sync-feishu` | 手动触发飞书员工同步 |

## 🔐 安全说明

- **传输安全**：API Key 通过 HTTPS 传输（生产环境必须启用）
- **身份联动**：员工离职后飞书账号停用，API Key 自动失效
- **密钥管理**：管理员可一键重置任何员工的 Key
- **敏感字段加密**：API Key、AccessKey Secret 使用 AES-256-GCM 加密存储（`enc:v1:` 前缀）
- **请求限频**：60 次/分钟/人，防止滥用
- **三级限额**：个人/部门/公司月度预算，超限自动拦截
- **审计日志**：管理员所有操作有记录
- **JWT 认证**：管理后台 API 使用 JWT 鉴权

## 💰 费用计算

默认模型单价（可在渠道管理页面调整）：

| 模型 | 输入价格 | 输出价格 | 缓存命中 |
|------|---------|---------|---------|
| deepseek-chat | ¥1.00/M tokens | ¥2.00/M tokens | ¥0.10/M tokens |
| deepseek-reasoner | ¥4.00/M tokens | ¥16.00/M tokens | ¥0.40/M tokens |

模型价格每天凌晨 3 点自动同步，汇率自动从 USD 转换为 CNY。

## 🗄️ 数据库

使用 **sql.js**（WASM 版 SQLite），数据文件存储在 Docker 卷中：

- **开发环境**：`./data.db`（项目根目录）
- **Docker 环境**：`/data/data.db`（命名卷）

共 9 张表：`users`、`channels`、`usage_logs`、`model_prices`、`quota_settings`、`alert_settings`、`alert_logs`、`audit_logs`、`feishu_sync_logs`

## 🔧 环境变量完整参考

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `FEISHU_APP_ID` | ✅ | — | 飞书应用 ID |
| `FEISHU_APP_SECRET` | ✅ | — | 飞书应用密钥 |
| `FEISHU_REDIRECT_URI` | ✅ | — | OAuth 回调地址 |
| `NEXT_PUBLIC_FEISHU_APP_ID` | ✅ | — | 浏览器端飞书 App ID（同 FEISHU_APP_ID） |
| `NEXT_PUBLIC_FEISHU_REDIRECT_URI` | ✅ | — | 浏览器端回调地址（同 FEISHU_REDIRECT_URI） |
| `JWT_SECRET` | ✅ | `change-me` | JWT 签名密钥，生产环境必须修改 |
| `ADMIN_EMAILS` | ✅ | — | 管理员邮箱（逗号分隔） |
| `PROXY_PORT` | — | `3001` | 代理网关端口 |
| `WEB_PORT` | — | `3000` | 管理后台端口 |
| `DATABASE_URL` | — | `./data.db` | 数据库文件路径 |
| `PROXY_BASE_URL` | — | `http://proxy:3001` | 容器内 web→proxy 通信地址 |
| `NODE_ENV` | — | `development` | 运行环境 |

> ⚠️ `NEXT_PUBLIC_` 前缀变量会暴露到浏览器，不要放密钥。

## 🐛 故障排查

### 常见问题

**Q：启动后页面报 500 错误**
- 检查 `DATABASE_URL` 是否正确
- 检查 Docker 卷挂载是否正常：`docker compose exec web ls -la /data/`

**Q：飞书登录失败**
- 确认 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 正确
- 确认回调地址与飞书开放平台配置一致
- 确认 `NEXT_PUBLIC_FEISHU_APP_ID` 已设置（浏览器端需要）

**Q：余额同步失败**
- DeepSeek/硅基流动：检查渠道 API Key 是否正确
- 阿里千问：检查 AccessKey ID / Secret 是否正确
- 查看日志：`docker compose logs web | grep BalanceSync`

**Q：飞书告警没收到**
- 检查管理后台「告警设置」中 Webhook URL 是否已配置
- 确认 `feishu_notify_enabled` 已开启
- 确认告警类型包含需要通知的类型
- 查看日志：`docker compose logs web | grep AnomalyDetect`

**Q：渠道余额显示"待同步"**
- 点击「同步所有余额」按钮手动触发
- 检查渠道的 `balanceSyncMode` 是否为 `auto`
- 代理网关需健康运行：`docker compose logs proxy | grep health`

### 查看日志

```bash
# 所有服务日志
docker compose logs -f

# 仅管理后台
docker compose logs -f web

# 仅代理网关
docker compose logs -f proxy

# 定时任务日志
docker compose logs web | grep "\[AutoSync\]"
```

## 📄 许可证

MIT
