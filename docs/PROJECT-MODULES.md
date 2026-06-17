# 玄牝词元 — AI Token 管理系统 模块文档

> 最后更新：2026-06-05

## 一、项目概述

**玄牝词元** 是一个公司级 AI API 代理网关 + 管理后台，核心功能包括：

- **API 代理**：OpenAI 兼容协议的请求转发，支持多渠道负载均衡和故障切换
- **用量计费**：按模型 Token 精确计费，支持渠道专属定价和全局定价
- **飞书集成**：OAuth 登录、员工目录同步、机器人预警通知
- **管理后台**：渠道管理、价格管理、额度控制、权限管理、数据报表
- **数据清洗**：组织架构规范化和员工去重

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16 + React 19 + TailwindCSS + Recharts |
| 后端 | Next.js API Routes + Hono（代理服务） |
| 数据库 | SQLite（sql.js 内存数据库 + 文件持久化）+ Drizzle ORM |
| 认证 | 飞书 OAuth + JWT（jose 库） |
| 部署 | pnpm workspace monorepo |

### 项目结构

```
ai-token-manager/
├── shared/          # 共享模块（Schema、类型、迁移）
├── web/             # Next.js 管理后台 + API 代理
├── proxy/           # Hono 独立代理服务（备选）
├── data.db          # SQLite 数据库文件（8.2MB）
└── docs/            # 项目文档
```

---

## 二、数据库设计（9 张表）

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `users` | 用户表 | id, feishu_id, name, api_key, role, department, monthly_quota |
| `channels` | 上游渠道表 | id, name, base_url, api_key, models(JSON), priority |
| `usage_logs` | 用量记录表 | id, user_id, model, input/output/total_tokens, cost, channel_id |
| `quota_rules` | 限额规则表 | id, scope(company/department/personal), target_id, monthly_limit |
| `alert_logs` | 预警记录表 | id, type, target_id, message |
| `model_prices` | 模型价格表 | id, model, channel_id, input/output/cache_per_million |
| `sync_blacklist` | 同步黑名单 | model (PK) |
| `alert_settings` | 预警设置 | key (PK), value |
| `admin_logs` | 管理操作日志 | id, admin_id, action, target_type, target_id, detail(JSON) |

### 角色体系

| 角色 | 权限范围 |
|------|----------|
| `admin` | 全部管理功能 |
| `finance` | 总览、部门费用、导出报表（只读） |
| `dept_manager` | 员工/部门排行、导出报表 |
| `member` | 个人用量、API Key 管理 |

---

## 三、后端模块

### 3.1 认证模块

| 文件 | 功能 |
|------|------|
| `web/src/lib/auth.ts` | JWT 会话管理（创建/验证/清除），Cookie 名 `token`，30天有效期 |
| `web/src/lib/feishu.ts` | 飞书 OpenAPI 集成（OAuth Token 交换、用户/部门信息获取、部门树递归） |
| `web/src/lib/user-service.ts` | 用户 CRUD（飞书 ID 查找/创建、API Key 生成 `sk-{拼音}-{随机}`） |
| `web/src/lib/admin-check.ts` | API 路由权限校验中间件（`requireAdmin()`、`requireRole()`） |

#### 登录流程

1. 用户点击「飞书登录」→ 跳转飞书 OAuth 授权页
2. 回调 `GET /api/auth/feishu/callback` → 用 code 换 Token → 获取用户信息
3. `classifyDeptByName()` 按后缀"中心/部/组"自动分类三级架构
4. `findOrCreateUser()` 创建或更新用户记录
5. `createSession()` 签发 JWT → 设置 HttpOnly Cookie → 重定向到仪表盘

#### 开发模式登录

- `GET /api/auth/dev-login` — 仅非生产环境，直接以何广明（admin）身份创建会话

---

### 3.2 代理模块

| 文件 | 功能 |
|------|------|
| `web/src/lib/proxy.ts` | 核心 API 代理（认证→限速→额度→渠道路由→转发→计费→记录） |
| `web/src/lib/price-sync.ts` | 多供应商价格抓取（DeepSeek、GLM、OpenAI、Anthropic） |
| `web/src/lib/auto-sync.ts` | 定时任务调度（飞书同步每天12:00/19:00，价格同步每天03:00） |

#### 请求代理流程

```
客户端请求 → API Key 认证 → 限速检查(60次/分钟) → 额度检查(个人→部门→公司)
    → 按优先级查找渠道 → 转发到上游 API → 失败自动故障切换
    → 提取 Token 用量 → 三级定价计算费用 → 写入 usage_logs
```

#### 定价查找链

1. **渠道专属价格**：`(channelId, model)` 组合
2. **全局价格**：`(NULL, model)` — 官网同步创建
3. **硬编码兜底**：默认 deepseek-chat 价格

---

### 3.3 飞书集成

| 文件 | 功能 |
|------|------|
| `web/src/lib/feishu.ts` | 飞书 API 封装（Token、用户信息、部门树） |
| `web/src/lib/feishu-bot.ts` | 飞书机器人消息发送（私聊、群聊、预警格式化） |
| `web/src/app/api/setup/sync-feishu/route.ts` | 飞书目录同步管道（部门→三级树→用户→规范化→清理种子） |

#### 飞书同步流程

1. 获取飞书部门列表 → 按"中心/部/组"后缀分类为三级树
2. 收集各部门下的用户 → 补充完整组织架构信息
3. 规范化部门名称（`GROUP_TO_DEPT` 映射 + `DEPT_RENAME` 修正）
4. 清理种子用户前转移其用量日志到真实用户
5. 保护硬编码管理员（`HARDCODED_ADMIN_IDS`）不被删除

---

### 3.4 Admin API（19 个端点）

| 路由 | 方法 | 权限 | 功能 |
|------|------|------|------|
| `/api/admin/overview` | GET | admin/finance | 系统总览（总 Token、费用、活跃用户、趋势图） |
| `/api/admin/channels` | GET/POST/PUT/DELETE | admin | 上游渠道 CRUD，API Key 脱敏显示 |
| `/api/admin/models` | GET | admin | 按模型维度统计本月用量 |
| `/api/admin/prices` | GET/PUT/DELETE | admin | 模型价格管理（渠道定价、同步黑名单） |
| `/api/admin/prices/sync` | POST | admin | 触发官网价格同步 |
| `/api/admin/employees` | GET | admin/dept_manager | 员工用量排行（部门筛选、层级切换） |
| `/api/admin/departments` | GET | admin/finance/dept_manager | 部门费用排行（人均、占比） |
| `/api/admin/quotas` | GET/POST | admin | 月度限额管理（公司/部门/个人三级） |
| `/api/admin/permissions` | GET/PUT | admin | 用户角色管理（admin/dept_head/member） |
| `/api/admin/alerts` | GET | admin | 预警通知日志（最近100条） |
| `/api/admin/alerts/settings` | GET/PUT | admin | 预警阈值和飞书通知配置 |
| `/api/admin/alerts/test-feishu` | POST | admin | 飞书机器人测试消息 |
| `/api/admin/logs` | GET | admin | 管理员操作日志（最近200条） |
| `/api/admin/export` | GET | admin/finance/dept_manager | 导出 Excel 报表（员工+部门两个 Sheet） |
| `/api/admin/org-structure` | GET | admin | 组织架构树分析（中心→部门→组 + 异常检测） |
| `/api/admin/cleanup-preview` | GET | admin | 数据清洗预览（不写库） |
| `/api/admin/cleanup-execute` | POST | admin | 执行数据清洗（部门修正 + 同名去重） |
| `/api/admin/debug` | GET | 无 | 数据库诊断调试 |

---

### 3.5 用户端 API

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/usage/summary` | GET | 个人用量汇总（Token、费用、额度进度） |
| `/api/usage/chart` | GET | 用量趋势图数据（自适应时间粒度） |
| `/api/usage/details` | GET | 分页用量明细 |
| `/api/user/key` | GET/POST | API Key 查看（脱敏）/ 重新生成 |
| `/api/proxy/v1/chat/completions` | POST | OpenAI 兼容聊天代理 |
| `/api/proxy/v1/models` | GET | 可用模型列表 |
| `/api/setup/seed` | POST | 数据库初始化/种子数据 |
| `/api/setup/sync-feishu` | GET/POST | 飞书目录同步 |

---

## 四、前端页面

### 4.1 公共页面

| 路由 | 页面 | 功能 |
|------|------|------|
| `/login` | 登录页 | 飞书 OAuth 登录按钮，CSS 动画背景（粒子+轨道环） |
| `/dashboard` | 个人仪表盘 | 统计卡片 + 用量趋势图 + 额度进度条 |
| `/dashboard/key` | API Key 管理 | 密钥查看/复制/重置 + 环境变量配置命令 |

### 4.2 管理后台页面

| 路由 | 页面 | 功能 |
|------|------|------|
| `/dashboard/admin` | 管理概览 | 4项统计卡片 + 费用/Token 趋势折线图 |
| `/dashboard/admin/channels` | 渠道管理 | 上游渠道增删改查（名称、URL、Key、模型、优先级） |
| `/dashboard/admin/prices` | 价格管理 | 模型单价管理（渠道筛选、编辑、废弃、同步黑名单） |
| `/dashboard/admin/employees` | 员工排行 | TOP 3 领奖台 + 员工用量表格（部门筛选） |
| `/dashboard/admin/departments` | 部门排行 | TOP 3 领奖台 + 部门费用表格（层级切换） |
| `/dashboard/admin/quotas` | 额度管理 | 公司限额 + 个人限额（批量修改） |
| `/dashboard/admin/permissions` | 权限管理 | 按角色分组展示，下拉切换角色 |
| `/dashboard/admin/alerts` | 预警设置 | 阈值配置 + 飞书通知 + 预警记录 |
| `/dashboard/admin/logs` | 操作日志 | 管理员操作记录表 |
| `/dashboard/admin/billing` | 部门分账 | 饼图占比 + 柱状图人均 + 明细表格 + Excel 导出 |
| `/dashboard/admin/models` | 模型分析 | 饼图费用分布 + 模型用量表格 |

### 4.3 共享组件

| 组件 | 功能 |
|------|------|
| `TimeRangeFilter` | 时间范围选择器（今日/7天/30天/今年 + 历史月份下拉） |
| `SummaryCards` | 4 列统计卡片（Token、费用、已用、剩余） |
| `UsageChart` | Recharts 折线图（Token + 费用双线） |
| `QuotaProgress` | 月度额度进度条（三档颜色：<70%蓝/70-90%橙/≥90%红） |
| `KeyManager` | API Key 显示/复制/重置 + 终端配置命令 |

---

## 五、Proxy 独立服务（Hono）

> 备选的独立代理服务，功能与 `web/src/lib/proxy.ts` 相同

| 文件 | 功能 |
|------|------|
| `proxy/src/index.ts` | Hono 入口，挂载中间件和路由，端口 3001 |
| `proxy/src/middleware/auth.ts` | API Key 认证（`sk-emp-xxx` 前缀） |
| `proxy/src/middleware/quota.ts` | 三级额度检查（个人→部门→公司） |
| `proxy/src/middleware/rate-limit.ts` | 滑动窗口限速（60次/分钟） |
| `proxy/src/services/channel.ts` | 渠道查找（优先级排序 + 故障切换） |
| `proxy/src/services/proxy.ts` | 请求转发（流式/非流式，自动故障切换） |
| `proxy/src/services/usage.ts` | 用量提取和记录 |
| `proxy/src/utils/pricing.ts` | 三级定价计算（渠道价→全局价→兜底） |

---

## 六、数据清洗模块

### 清洗规则

| 映射类型 | 示例 |
|----------|------|
| 组→部门映射 | "产品一组"→"产品部"、"开发组"→"IT部"、"运营组"→"运营部" |
| 部门名修正 | "开发部"→"产品部"、"平台部"→"IT部" |
| 用户覆盖 | `USER_DEPT_OVERRIDE` 字典强制指定某些用户的部门 |

### 清洗流程

1. 按 `feishu_id` 去重，保留组织信息更完整的记录
2. 五步清洗：组映射 → 部门名修正 → 组名检测 → 直接使用 → 兜底
3. 检测"组部门冲突"（组映射的部门与原部门不一致）
4. 执行清洗：更新所有用户部门 + 同名用户合并（保留种子用户，转移用量日志）

---

## 七、关键配置

### 环境变量（`web/.env.local`）

```env
# 飞书应用
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_REDIRECT_URI=http://localhost:3000/api/auth/feishu/callback

# 认证
JWT_SECRET=dev-secret-change-in-production

# 管理员识别
ADMIN_EMAILS=admin@yourcompany.com

# 数据库路径（相对于 web/ 目录）
DATABASE_URL=../data.db
```

### 启动命令

```bash
pnpm dev:web      # 启动管理后台（端口 3000）
pnpm dev:proxy    # 启动独立代理服务（端口 3001）
```

### 开发快捷登录

```
http://localhost:3000/api/auth/dev-login
```

---

## 八、当前状态与已知问题

### ✅ 已完成功能

- [x] 飞书 OAuth 登录 + 本地开发登录
- [x] 飞书员工目录同步（三级组织架构）
- [x] API 代理（多渠道负载均衡 + 故障切换）
- [x] Token 精确计费（渠道/全局/兜底三级定价）
- [x] 管理后台全部页面（11个管理功能）
- [x] Excel 报表导出
- [x] 预警系统（阈值 + 飞书通知）
- [x] 权限管理（4 种角色 + 菜单权限）
- [x] 数据清洗（部门规范化 + 同名去重）
- [x] 定时同步（飞书目录 + 价格更新）

### ⚠️ 已知问题

1. **`/api/admin/debug` 无权限校验** — 任何人可访问，生产环境需关闭
2. **`shared/migrate.ts` 不完整** — 未覆盖 `modelPrices`、`syncBlacklist`、`alertSettings` 三张表（通过 `prices/route.ts` 的 `ensureTable` 补建）
3. **数据库路径依赖相对路径** — `DATABASE_URL=../data.db` 需确保从 `web/` 目录启动
4. **内存数据库 + 文件持久化** — 不适合高并发生产环境，需考虑迁移到 PostgreSQL

### 📋 待优化方向

- 渠道+模型定价改造（Plan 已制定，见 `.claude/plans/optimized-coalescing-sparkle.md`）
- 生产环境部署（PostgreSQL 迁移、Docker 化）
- debug 端点加权限保护或移除
- migrate.ts 补全所有表的建表语句
