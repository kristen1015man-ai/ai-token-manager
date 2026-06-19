# Development Plan — AI Token 管家

> 本文件记录 AI Token 管家项目的开发阶段划分、当前进度和剩余工作。
> 新 session 启动时应首先阅读此文件，了解项目状态后再继续开发。
> 本项目是独立于 ASIN 分类系统的新产品，项目根目录为 `ai-token-manager/`。

---

## Phase 1: 项目骨架 + 数据库 + 飞书登录

**交付内容**：
- 搭建 monorepo 项目结构：`proxy/`（Hono API 代理）+ `web/`（Next.js 管理后台）+ `shared/`（共享类型）
- 初始化 PostgreSQL 数据库，创建 users、channels、quota_rules、alert_logs、admin_logs 五张表
- 配置 Drizzle ORM 连接数据库，编写 migration 脚本
- 实现飞书 OAuth 2.0 登录：点击登录 → 飞书授权 → 回调创建/更新用户 → 签发 JWT session
- 飞书用户信息自动同步：姓名、头像、部门、工号
- 首次登录自动生成专属 API Key（`sk-emp-{feishu_id}-{8位随机码}`）
- 管理后台基础布局：顶部导航栏（飞书头像+姓名+登出）+ 左侧菜单 + 内容区
- 基础路由：登录页 `/login`、仪表盘首页 `/dashboard`（暂显示占位欢迎信息）
- 角色区分：首次部署时指定管理员（通过环境变量 `ADMIN_IDS`），管理员 vs 普通员工菜单不同

**关键文件**：
- `ai-token-manager/package.json` — monorepo 根配置（pnpm workspace）
- `ai-token-manager/proxy/package.json` — 代理网关依赖（hono、drizzle-orm、better-sqlite3/pg）
- `ai-token-manager/proxy/src/index.ts` — Hono 代理入口，启动 HTTP 服务器
- `ai-token-manager/web/package.json` — 管理后台依赖（next、react、tailwindcss、recharts）
- `ai-token-manager/web/src/app/layout.tsx` — 根布局（字体、全局样式）
- `ai-token-manager/web/src/app/login/page.tsx` — 飞书登录页（飞书登录按钮）
- `ai-token-manager/web/src/app/dashboard/layout.tsx` — 仪表盘布局（侧边栏 + 顶栏）
- `ai-token-manager/web/src/app/dashboard/page.tsx` — 仪表盘首页（欢迎信息占位）
- `ai-token-manager/web/src/lib/auth.ts` — 飞书 OAuth 流程（获取 code → 换 token → 获取用户信息）
- `ai-token-manager/web/src/lib/db.ts` — Drizzle ORM 初始化 + 连接池
- `ai-token-manager/web/src/lib/feishu.ts` — 飞书 API 封装（获取用户信息、部门信息）
- `ai-token-manager/shared/schema.ts` — Drizzle 表定义（users、channels、quota_rules、alert_logs、admin_logs）
- `ai-token-manager/shared/types.ts` — 共享 TypeScript 类型定义（User、Channel、QuotaRule 等）
- `ai-token-manager/docker-compose.yml` — PostgreSQL 服务定义（开发环境）
- `ai-token-manager/.env.example` — 环境变量模板（数据库连接、飞书 App ID/Secret、JWT 密钥）

**验收标准**：
- `pnpm install` 成功，两个子项目（proxy、web）均能启动
- `docker-compose up -d` 启动 PostgreSQL，migration 脚本创建全部 5 张表
- 浏览器打开 `http://localhost:3000/login`，点击飞书登录按钮，完成 OAuth 流程后跳转到 dashboard
- 数据库 users 表中创建了用户记录，包含飞书同步的姓名、部门、头像、生成的 API Key
- 管理员账号登录后左侧菜单显示"用户管理"、"渠道管理"等管理菜单；普通员工只看到"我的用量"、"API Key"

---

## Phase 2: API 代理核心

**交付内容**：
- 实现 OpenAI 兼容格式的 API 代理：接收 `/v1/chat/completions` 请求，转发到上游 API
- 实现 `/v1/models` 接口，返回后台配置的可用模型列表
- API Key 认证中间件：从请求 Header 提取 `Authorization: Bearer sk-emp-xxx`，查询数据库验证身份
- SSE 流式响应代理：上游返回 SSE 流时，逐 chunk 转发给客户端，保持打字机效果
- 非流式响应代理：上游返回完整 JSON 时，直接转发
- 用量记录写入：从上游响应的 `usage` 字段提取 `prompt_tokens`、`completion_tokens`，按模型单价表计算费用，写入 usage_logs 表
- 流式响应的用量提取：SSE 流最后一个 `data: [DONE]` 之前的 chunk 中包含 `usage` 字段，解析并记录
- 渠道路由：根据请求的 model 字段，从 channels 表查找匹配的渠道（优先级最高的启用渠道）
- 渠道故障切换：主渠道请求失败（5xx 或超时 30s）时，尝试下一个优先级渠道
- 模型单价配置表（硬编码在代码中，后续 Phase 改为数据库配置）：DeepSeek V4 Flash 输入 ¥1/M tokens，输出 ¥2/M tokens；DeepSeek V4 Pro 输入 ¥4/M tokens，输出 ¥16/M tokens

**关键文件**：
- `ai-token-manager/proxy/src/index.ts` — 扩展：注册路由和中间件
- `ai-token-manager/proxy/src/middleware/auth.ts` — API Key 认证中间件（解析 Key → 查询 users 表 → 注入 user 信息到 context）
- `ai-token-manager/proxy/src/routes/chat.ts` — `/v1/chat/completions` 路由处理（解析请求 → 渠道路由 → 转发 → 记录用量）
- `ai-token-manager/proxy/src/routes/models.ts` — `/v1/models` 路由处理（从 channels 表聚合可用模型列表）
- `ai-token-manager/proxy/src/services/proxy.ts` — 代理转发核心逻辑（构建上游请求、处理流式/非流式响应）
- `ai-token-manager/proxy/src/services/usage.ts` — 用量记录服务（提取 Token 数、计算费用、写入 usage_logs 表）
- `ai-token-manager/proxy/src/services/channel.ts` — 渠道查询服务（根据 model 查找渠道、故障切换）
- `ai-token-manager/proxy/src/utils/pricing.ts` — 模型单价表 + 费用计算函数
- `ai-token-manager/shared/schema.ts` — 更新：添加 usage_logs 表定义

**验收标准**：
- 代理服务启动在 `http://localhost:3001`
- 用 curl 或 Postman 发送请求到 `http://localhost:3001/v1/chat/completions`，携带有效的 sk-emp Key，能收到 DeepSeek 的正常回复
- 发送流式请求（`stream: true`），能收到逐字输出的 SSE 流
- 发送请求后，数据库 usage_logs 表中有新记录，包含正确的 input_tokens、output_tokens、cost
- 携带无效 Key 请求时返回 401 错误
- 在数据库 channels 表手动插入一条渠道记录后，`/v1/models` 返回该渠道的模型列表

---

## Phase 3: 员工仪表盘

**交付内容**：
- 今日概览卡片：今日已用 Token 数、今日花费金额、本月累计花费、剩余额度（进度条展示）
- 分时段用量折线图：支持按小时（今日）、按天（本月）、按周（近 3 月）、按月（全年）切换，使用 Recharts 绘制
- 使用明细列表：表格展示每次调用的模型、输入 Token、输出 Token、费用、时间点，支持分页（每页 20 条）
- 我的 API Key 页面：新建 Key 后只展示一次完整值；后续只展示脱敏值，丢失后必须新建。
- 后端 API：`/api/usage/summary`（今日/本月汇总）、`/api/usage/chart?granularity=hourly|daily|weekly|monthly`（分时段数据）、`/api/usage/details?page=1&size=20`（明细列表）、`/api/user/key`（Key 管理）

**关键文件**：
- `ai-token-manager/web/src/app/dashboard/page.tsx` — 重写：今日概览卡片 + 分时段用量图 + 最近调用明细
- `ai-token-manager/web/src/app/dashboard/chart/page.tsx` — 详细用量图表页（更多时间粒度选择）
- `ai-token-manager/web/src/app/dashboard/details/page.tsx` — 使用明细列表页
- `ai-token-manager/web/src/app/dashboard/key/page.tsx` — API Key 管理页
- `ai-token-manager/web/src/components/dashboard/summary-cards.tsx` — 今日概览卡片组件
- `ai-token-manager/web/src/components/dashboard/usage-chart.tsx` — 分时段用量折线图组件（Recharts）
- `ai-token-manager/web/src/components/dashboard/usage-table.tsx` — 使用明细表格组件
- `ai-token-manager/web/src/components/dashboard/key-manager.tsx` — API Key 展示/复制/重置组件
- `ai-token-manager/web/src/components/dashboard/quota-progress.tsx` — 额度进度条组件
- `ai-token-manager/web/src/app/api/usage/summary/route.ts` — 用量汇总 API
- `ai-token-manager/web/src/app/api/usage/chart/route.ts` — 分时段数据 API
- `ai-token-manager/web/src/app/api/usage/details/route.ts` — 使用明细 API
- `ai-token-manager/web/src/app/api/user/key/route.ts` — Key 管理 API（GET 查看、POST 重置）

**验收标准**：
- 员工登录后，dashboard 首页显示今日概览卡片（Token 数、费用、额度进度条）
- 分时段图默认显示今日按小时数据，切换到"本月"显示按天数据
- 使用明细列表正确展示每次调用的模型、Token、费用、时间
- API Key 页面能复制 Key、复制配置命令，重置 Key 后旧 Key 立即失效（用旧 Key 调代理返回 401）

---

## Phase 4: 管理员后台 + 部门分账

**交付内容**：
- 全局概览页：全公司今日/本月总费用、活跃用户数、总请求数、费用趋势折线图（对比上月同期）
- 部门排行页：各部门本月费用排名柱状图、各部门人数、人均费用、点击部门查看部门内员工明细
- 员工排行页：本月用量 Top 20 员工列表（费用、Token 数、请求次数），支持按部门筛选
- 部门分账页：按部门汇总本月费用，表格展示（部门名、人数、总费用、人均费用），导出 Excel 按钮
- 模型分布页：饼图展示各模型的用量占比（按 Token 数和按费用两个维度）
- 报表导出：月度 Excel 报表，字段包括部门、员工姓名、模型、输入 Token、输出 Token、费用、月份，使用 xlsx 库生成
- 后端 API：`/api/admin/overview`（全局统计）、`/api/admin/departments`（部门排行）、`/api/admin/employees`（员工排行）、`/api/admin/models`（模型分布）、`/api/admin/export?month=2026-05`（Excel 导出）

**关键文件**：
- `ai-token-manager/web/src/app/dashboard/admin/page.tsx` — 管理员全局概览页
- `ai-token-manager/web/src/app/dashboard/admin/departments/page.tsx` — 部门排行页
- `ai-token-manager/web/src/app/dashboard/admin/employees/page.tsx` — 员工排行页
- `ai-token-manager/web/src/app/dashboard/admin/billing/page.tsx` — 部门分账页
- `ai-token-manager/web/src/app/dashboard/admin/models/page.tsx` — 模型分布页
- `ai-token-manager/web/src/components/admin/stats-cards.tsx` — 全局统计卡片组件
- `ai-token-manager/web/src/components/admin/department-chart.tsx` — 部门费用柱状图组件
- `ai-token-manager/web/src/components/admin/employee-table.tsx` — 员工排行表格组件
- `ai-token-manager/web/src/components/admin/model-pie-chart.tsx` — 模型分布饼图组件
- `ai-token-manager/web/src/app/api/admin/overview/route.ts` — 全局统计 API
- `ai-token-manager/web/src/app/api/admin/departments/route.ts` — 部门排行 API
- `ai-token-manager/web/src/app/api/admin/employees/route.ts` — 员工排行 API
- `ai-token-manager/web/src/app/api/admin/models/route.ts` — 模型分布 API
- `ai-token-manager/web/src/app/api/admin/export/route.ts` — Excel 导出 API

**验收标准**：
- 管理员登录后能看到全局概览页（总费用、活跃人数、趋势图）
- 部门排行页正确显示各部门费用排名，点击部门能展开看员工明细
- 员工排行页显示 Top 20，按部门筛选功能正常
- 导出 Excel 文件能正常下载打开，字段完整
- 普通员工登录后看不到管理页面（菜单不显示，直接访问 URL 返回 403）

---

## Phase 5: 限额引擎 + 飞书预警

**交付内容**：
- 限额配置管理 UI：管理员可以为公司、部门、个人分别设置月度费用上限，修改后立即生效
- 代理网关限额中间件：每次请求前检查个人额度 → 部门额度 → 公司额度，任一超额返回友好 JSON 错误提示
- 额度不足时的标准错误响应：包含已用额度、总额度、周期、管理员联系方式
- 个人额度管理 UI：管理员可查看/调整每个员工的月度限额，支持批量设置
- 部门额度管理 UI：管理员可查看/调整每个部门的月度限额
- 飞书机器人预警通知：个人额度达 80%/100% 私聊通知该员工；部门预算达 80% 群通知部门负责人+管理员；公司预算达 90% 群通知管理员
- 异常使用检测：同一个人 1 小时内用量超过该人过去 7 天小时均值的 5 倍时，群通知管理员
- 预警记录页面：管理员查看历史预警记录

**关键文件**：
- `ai-token-manager/proxy/src/middleware/quota.ts` — 限额检查中间件（查询当月累计费用 → 对比限额 → 超额拦截）
- `ai-token-manager/proxy/src/services/anomaly.ts` — 异常使用检测服务（对比近期均值）
- `ai-token-manager/web/src/app/dashboard/admin/quotas/page.tsx` — 限额配置管理页（公司/部门/个人三个 Tab）
- `ai-token-manager/web/src/app/dashboard/admin/alerts/page.tsx` — 预警记录页
- `ai-token-manager/web/src/components/admin/quota-editor.tsx` — 限额编辑组件（输入框 + 保存按钮）
- `ai-token-manager/web/src/components/admin/alert-table.tsx` — 预警记录表格组件
- `ai-token-manager/web/src/app/api/admin/quotas/route.ts` — 限额 CRUD API
- `ai-token-manager/web/src/app/api/admin/alerts/route.ts` — 预警记录查询 API
- `ai-token-manager/web/src/lib/feishu-bot.ts` — 飞书机器人消息发送封装（私聊 + 群消息）
- `ai-token-manager/web/src/services/alert.ts` — 预警触发判断 + 消息模板生成

**验收标准**：
- 管理员在后台设置个人月度限额为 ¥0.01（测试用），该员工下一次 API 请求返回额度不足错误
- 将限额恢复为 ¥200，请求正常通过
- 个人额度用到 80% 时，飞书收到私聊通知
- 异常使用触发后，管理员飞书群收到告警消息
- 预警记录页面展示历史预警

---

## Phase 6: 渠道管理 + 安全加固

**交付内容**：
- 渠道管理 CRUD UI：管理员可添加/编辑/禁用上游 API 渠道（名称、Base URL、API Key、支持模型列表、优先级、状态）
- 渠道 API Key 加密存储：使用 AES-256 加密后存入数据库，使用时解密
- 渠道健康检查：后台定时（每 5 分钟）向各渠道发送测试请求，状态异常时飞书通知管理员
- 请求频率限制：基于用户 ID 的内存滑动窗口限流，每分钟最多 60 次请求，超额返回 429
- Key 重置功能完善：管理员可在后台一键重置任何员工的 Key，旧 Key 立即失效
- 操作审计日志：管理员所有写操作（调额度、禁用 Key、改渠道）自动记录到 admin_logs 表
- 管理员操作日志页面：查看所有管理员操作历史

**关键文件**：
- `ai-token-manager/web/src/app/dashboard/admin/channels/page.tsx` — 渠道管理页（渠道列表 + 添加/编辑弹窗）
- `ai-token-manager/web/src/components/admin/channel-form.tsx` — 渠道编辑表单组件
- `ai-token-manager/web/src/components/admin/channel-status.tsx` — 渠道状态指示器组件（健康/异常）
- `ai-token-manager/web/src/app/api/admin/channels/route.ts` — 渠道 CRUD API
- `ai-token-manager/web/src/app/dashboard/admin/logs/page.tsx` — 管理操作日志页
- `ai-token-manager/web/src/app/api/admin/logs/route.ts` — 操作日志查询 API
- `ai-token-manager/proxy/src/middleware/rate-limit.ts` — 请求频率限制中间件（内存滑动窗口）
- `ai-token-manager/proxy/src/utils/encrypt.ts` — AES-256 加解密工具（渠道 API Key 加密存储）
- `ai-token-manager/proxy/src/services/health-check.ts` — 渠道健康检查定时任务
- `ai-token-manager/web/src/services/admin-log.ts` — 管理操作记录服务

**验收标准**：
- 管理员在后台添加新渠道（如硅基流动），添加后 `/v1/models` 返回新渠道的模型
- 禁用某个渠道后，请求不再路由到该渠道
- 同一个用户 1 分钟内发送超过 60 次请求时，第 61 次返回 429 Too Many Requests
- 管理员执行任何写操作后，admin_logs 表有对应记录
- 渠道健康检查能正确标记异常渠道

---

## Phase 7: Docker 部署 + 文档收尾

**交付内容**：
- 完整的 Docker Compose 配置：proxy + web + PostgreSQL 三个服务，配置健康检查和重启策略
- 代理网关 Dockerfile：Node.js 20 Alpine 基础镜像，多阶段构建
- 管理后台 Dockerfile：Next.js standalone 模式输出，多阶段构建
- `.env.production.example` 生产环境变量模板
- Nginx 反向代理配置示例（HTTPS + 域名）
- README.md 部署文档：环境要求、一键启动命令、飞书应用配置步骤、首次使用流程
- 数据库分区策略：usage_logs 表按月分区，保留 12 个月数据，自动清理过期分区
- 启动脚本 `start.sh`：检查环境变量 → 启动 Docker Compose → 等待数据库就绪 → 运行 migration → 启动服务

**关键文件**：
- `ai-token-manager/docker-compose.yml` — 更新：添加 proxy、web 服务定义，配置 depends_on、healthcheck、restart
- `ai-token-manager/docker-compose.prod.yml` — 生产环境 overlay（持久化卷、资源限制）
- `ai-token-manager/proxy/Dockerfile` — 代理网关 Docker 镜像构建
- `ai-token-manager/web/Dockerfile` — 管理后台 Docker 镜像构建
- `ai-token-manager/nginx/nginx.conf` — Nginx 反向代理配置（HTTPS、WebSocket/SSE 透传）
- `ai-token-manager/.env.production.example` — 生产环境变量模板
- `ai-token-manager/start.sh` — 一键启动脚本
- `ai-token-manager/README.md` — 项目文档（部署指南、飞书配置、员工使用说明）
- `ai-token-manager/shared/migrations/partition-usage-logs.sql` — usage_logs 按月分区 SQL

**验收标准**：
- 全新机器上 clone 项目后，配置 `.env`，运行 `docker-compose up -d`，所有服务正常启动
- 飞书登录正常、API 代理正常、仪表盘数据正常
- HTTPS 配置后，浏览器无证书警告
- README.md 文档足够清晰，新运维人员能独立完成部署

---

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| API 代理网关 | Hono | 4.12.x | 轻量高性能 Web 框架，原生支持 SSE 流式 |
| 管理后台 | Next.js | 16.2.x | React 全栈框架，App Router 模式 |
| UI 样式 | Tailwind CSS | 4.x | 工具类 CSS |
| 图表 | Recharts | 2.x | React 图表库，折线图/柱状图/饼图 |
| 数据库 ORM | Drizzle ORM | latest | TypeScript-first ORM，类型安全 |
| 数据库 | PostgreSQL | 16.x | 生产级关系数据库 |
| 飞书集成 | @larksuite/node-sdk | latest | 飞书官方 Node.js SDK |
| Excel 导出 | xlsx (SheetJS) | latest | 前端 Excel 生成 |
| 运行时 | Node.js | 20.x LTS | 稳定的长期支持版本 |
| 包管理 | pnpm | 10.x | workspace monorepo 管理 |
| 容器 | Docker Compose | latest | 一键部署 proxy + web + db |

## 数据库表

| 表名 | 所属 Phase | 用途 |
|------|-----------|------|
| `users` | Phase 1 | 员工信息（飞书同步）、API Key、角色、个人限额 |
| `channels` | Phase 1 | 上游 API 渠道配置（URL、Key、模型、优先级） |
| `quota_rules` | Phase 1 | 限额规则（公司/部门/个人维度） |
| `alert_logs` | Phase 1 | 预警通知记录 |
| `admin_logs` | Phase 1 | 管理员操作审计日志 |
| `usage_logs` | Phase 2 | 每次 API 调用的用量记录（Token、费用、时间） |

## 模型单价表（初始值，Phase 6 后可在后台配置）

| 模型 | 输入价格 (¥/M tokens) | 输出价格 (¥/M tokens) | 缓存命中价格 |
|------|----------------------|----------------------|-------------|
| deepseek-chat (V4 Flash) | 1.00 | 2.00 | 0.10 |
| deepseek-reasoner (V4 Pro) | 4.00 | 16.00 | 0.40 |

> 注：价格随 DeepSeek 官方调整，后续在渠道管理页面可配置

## 开发规则

- 每完成一个 Phase 执行四步走：Code Review → 测试完整性 → 编译验证 → 功能测试
- 四步走全部通过后才能 commit
- Commit message 格式：`phase-N: 简要描述`
- 包管理器：pnpm（workspace monorepo）
- 代理网关（proxy/）和管理后台（web/）是独立子项目，各自有 package.json
- 共享类型和数据库 schema 放在 shared/ 目录，两个子项目通过 workspace 引用
- API 代理监听端口 3001，管理后台监听端口 3000
- 所有 API 响应遵循 OpenAI 兼容格式，错误响应也保持一致结构
