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

## 🏗️ 系统架构

```
员工代码/工具
    ↓ 请求（带专属 sk-xxx Key）
API 代理网关（认证 → 限频 → 限额 → 转发 → 记录）
    ↓
DeepSeek / Claude / 其他模型 API

管理后台（飞书登录 → 查看用量 → 管理限额 → 导出报表）
```

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
- ✅ 飞书机器人预警通知
- ✅ 管理操作审计日志

### 代理网关
- ✅ OpenAI 兼容接口（`/v1/chat/completions`）
- ✅ SSE 流式响应（打字机效果）
- ✅ 渠道故障自动切换
- ✅ 每次调用自动记录 Token 和费用
- ✅ API Key 认证 + 请求限频 + 限额拦截

## 🚀 快速开始

### 环境要求

- Docker + Docker Compose
- 飞书企业版（需创建自建应用）

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
# 必填项：
#   FEISHU_APP_ID=cli_xxxx
#   FEISHU_APP_SECRET=xxxx
#   FEISHU_REDIRECT_URI=https://ai.yourcompany.com/api/auth/feishu/callback
#   JWT_SECRET=随机长字符串至少32位
#   ADMIN_EMAILS=admin@yourcompany.com
```

### 第三步：启动服务

```bash
# 一键启动
docker compose up -d

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
├── web/                      # 管理后台 (Next.js 16)
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/           # 后端 API 路由
│   │   │   ├── dashboard/     # 仪表盘页面
│   │   │   └── login/         # 飞书登录页
│   │   ├── components/        # UI 组件
│   │   └── lib/               # 工具库（认证、数据库、飞书）
│   └── Dockerfile
├── shared/                   # 共享类型和数据库 Schema
│   ├── schema.ts             # Drizzle ORM 表定义
│   ├── types.ts              # TypeScript 类型
│   └── db.ts                 # 数据库连接
├── nginx/                    # Nginx 反向代理配置
├── docker-compose.yml
├── .env.production.example
└── README.md
```

## 🔐 安全说明

- API Key 通过 HTTPS 传输（生产环境必须启用）
- 员工离职后飞书账号停用，API Key 自动失效
- 管理员可一键重置任何员工的 Key
- 请求限频防止滥用（60 次/分钟/人）
- 三级限额（个人/部门/公司）防止超额
- 管理员所有操作有审计日志

## 💰 费用计算

默认模型单价（可在渠道管理页面调整）：

| 模型 | 输入价格 | 输出价格 | 缓存命中 |
|------|---------|---------|---------|
| deepseek-chat | ¥1.00/M tokens | ¥2.00/M tokens | ¥0.10/M tokens |
| deepseek-reasoner | ¥4.00/M tokens | ¥16.00/M tokens | ¥0.40/M tokens |

## 📄 许可证

MIT
