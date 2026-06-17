# AI Token Manager — 架构设计文档

> 最后更新：2025-06-08
> 本文档使用 Mermaid 图表语法，VS Code 安装 "Markdown Preview Mermaid Support" 插件可直接预览，GitHub 也原生支持。

---

## 一、系统架构总览

```mermaid
graph TB
    subgraph 用户端
        Browser[🌐 浏览器]
        AIClient[🤖 AI 客户端<br/>Cursor/Copilot/Cline...]
    end

    subgraph "Next.js Web 服务（端口 3000）"
        MW[Edge Middleware<br/>JWT鉴权 + 安全头]
        Pages[React 页面<br/>13个 Dashboard 页面]
        API[API Routes<br/>44个接口端点]
        Sync[定时任务调度器<br/>auto-sync.ts]
    end

    subgraph "Hono Proxy 网关（端口 3001）"
        Auth[API Key 鉴权<br/>HMAC-SHA256]
        RateLimit[限流<br/>60次/分钟]
        QuotaCheck[限额检查<br/>个人→部门→公司]
        Router[渠道路由<br/>优先级 + 故障转移]
    end

    subgraph 外部服务
        Feishu[🟢 飞书<br/>OAuth + 通讯录 + 消息]
        AI[AI 模型服务商<br/>DeepSeek/OpenAI/Anthropic/GLM/...]
    end

    subgraph 数据层
        DB[(SQLite<br/>data.db)]
        Drizzle[Drizzle ORM]
        Crypto[AES-256-GCM<br/>敏感字段加密]
    end

    Browser -->|HTTPS| MW
    MW -->|JWT 验证| Pages
    MW -->|角色检查| API
    AIClient -->|Bearer sk-xxx| Auth
    Auth --> RateLimit --> QuotaCheck --> Router
    Router -->|转发请求| AI

    API --> Drizzle
    Pages --> API
    Sync -->|INTERNAL_API_KEY| API
    API --> Feishu
    Drizzle --> DB
    Drizzle --> Crypto

    style Browser fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
    style AIClient fill:#fce7f3,stroke:#db2777,color:#9d174d
    style DB fill:#fef3c7,stroke:#d97706,color:#92400e
    style Feishu fill:#dcfce7,stroke:#16a34a,color:#166534
    style AI fill:#f3e8ff,stroke:#9333ea,color:#581c87
```

---

## 二、认证与鉴权流程

### 2.1 飞书 OAuth 登录流程

```mermaid
sequenceDiagram
    participant U as 用户浏览器
    participant W as Next.js 服务
    participant F as 飞书 OAuth
    participant DB as SQLite

    U->>W: 访问 /login
    W->>U: 展示登录页（飞书登录按钮）
    U->>W: 点击「飞书登录」
    W->>W: 生成 CSRF state + 设置 HttpOnly Cookie
    W->>U: 302 重定向到飞书授权页
    U->>F: 飞书登录 + 授权
    F->>U: 302 重定向回 /api/auth/feishu/callback?code=xxx&state=yyy
    U->>W: GET /callback
    W->>W: 验证 state (timingSafeEqual)
    W->>F: 用 code 换 access_token
    W->>F: 用 token 获取用户信息 + 部门信息
    W->>DB: findOrCreateUser (upsert)
    W->>DB: 三级部门分类 (center/department/group)
    W->>W: 签发 JWT (HS256, 30天有效)
    W->>U: Set-Cookie + 302 到 /dashboard
```

### 2.2 AI 请求鉴权流程

```mermaid
sequenceDiagram
    participant C as AI 客户端
    participant P as Proxy 网关
    participant DB as SQLite
    participant AI as 上游 AI 服务

    C->>P: POST /v1/chat/completions<br/>Authorization: Bearer sk-emp-xxx

    P->>P: HMAC-SHA256(sk-emp-xxx) → hash
    P->>DB: SELECT * FROM users WHERE apiKeyHash = hash
    DB-->>P: user (含 status, monthlyQuota)

    alt 用户不存在或已禁用
        P-->>C: 401 Unauthorized
    end

    P->>P: 滑动窗口限流检查 (60/min)

    alt 超过限流
        P-->>C: 429 Too Many Requests
    end

    P->>DB: 查询个人/部门/公司限额
    P->>DB: 查询当月已用额度

    alt 超过限额
        P-->>C: 403 Quota Exceeded
    end

    P->>DB: 按优先级查找可用渠道
    P->>AI: 转发请求

    alt 主渠道失败
        P->>DB: 查找备用渠道
        P->>AI: 转发到备用渠道
    end

    AI-->>P: 响应 (流式 SSE / JSON)
    P-->>C: 透传响应
    P->>DB: 异步记录用量 (batch flush)
```

---

## 三、数据流架构

### 3.1 用量记录流水线

```mermaid
flowchart LR
    subgraph 输入
        Proxy[Proxy 网关]
        Batch[内存缓冲区<br/>2秒 flush / 最多50条]
    end

    subgraph 处理
        Write[usage_logs 表]
        Price[model_prices 表<br/>三级定价查找]
    end

    subgraph 输出
        Dashboard[Dashboard 可视化]
        Ranking[排行榜]
        Billing[分账报表]
        Export[Excel 导出]
        Alert[预警通知]
    end

    Proxy -->|每次请求| Batch
    Batch -->|定时 flush| Write
    Write --> Dashboard
    Write --> Ranking
    Write --> Billing
    Write --> Export
    Write --> Alert
    Price -->|费用计算| Write

    style Proxy fill:#f3e8ff,stroke:#9333ea
    style Dashboard fill:#e0f2fe,stroke:#0284c7
    style Alert fill:#fee2e2,stroke:#dc2626
```

### 3.2 费用计算优先级

```mermaid
flowchart TD
    A[请求完成<br/>inputTokens + outputTokens] --> B{查找定价}

    B --> C[1️⃣ 渠道特定价格<br/>model_prices.channelId = 'xxx']
    C -->|找到| F[✅ 使用此价格]

    C -->|未找到| D[2️⃣ 全局价格<br/>model_prices.channelId IS NULL]
    D -->|找到| F

    D -->|未找到| E[3️⃣ 硬编码兜底价格<br/>代码内置]
    E --> F

    F --> G{币种 = USD?}
    G -->|是| H[乘以汇率 → CNY]
    G -->|否| I[直接使用 CNY]

    H --> J[cost = input × inputPrice + output × outputPrice]
    I --> J
```

---

## 四、定时任务调度

```mermaid
gantt
    title 每日定时任务时间线
    dateFormat HH:mm
    axisFormat %H:%M

    section 启动时
    飞书+价格同步     :milestone, m1, 00:30, 0m
    余额同步          :milestone, m2, 01:00, 0m
    异常检测          :milestone, m3, 01:30, 0m
    员工状态检查      :milestone, m4, 02:00, 0m

    section 定时任务
    排行榜推送        :crit, t1, 10:00, 1m
    飞书员工同步      :active, t2, 12:00, 10m
    飞书员工同步(晚)  :active, t3, 19:00, 10m
    员工状态检查      :t4, 20:00, 5m
    模型价格同步      :t5, 03:00, 10m
    渠道余额同步      :t6, 04:00, 5m
    异常用量检测      :t7, 00:00, 60m
```

```mermaid
flowchart TD
    subgraph auto-sync.ts 启动流程
        S[服务器启动] --> S1[30s: 飞书同步 + 价格同步]
        S --> S2[60s: 余额同步]
        S --> S3[90s: 异常检测]
        S --> S4[120s: 员工状态检查]
    end

    subgraph 每日定时
        D1[10:00 排行榜推送]
        D2[12:00 飞书员工同步]
        D3[19:00 飞书员工同步]
        D4[20:00 员工状态检查]
        D5[03:00 模型价格同步]
        D6[04:00 渠道余额同步]
    end

    subgraph 每小时
        H1[异常用量检测<br/>1小时窗口 vs 7天均值 × 5]
    end

    D2 & D3 --> FS[飞书通讯录 API]
    D5 --> PS[各厂商官网爬取]
    D6 --> BS[各渠道余额 API]
    D1 --> FN[飞书群消息卡片]
    H1 --> FN2[飞书异常预警卡片]

    style S fill:#dbeafe,stroke:#2563eb
    style FS fill:#dcfce7,stroke:#16a34a
```

---

## 五、角色权限矩阵

```mermaid
graph LR
    subgraph 角色
        Admin[👑 Admin]
        Finance[💰 Finance]
        DeptMgr[👔 Dept Manager]
        Member[👤 Member]
    end

    subgraph 页面
        Usage[我的用量]
        Key[API Key]
        Overview[全局概览]
        DeptRank[部门排行]
        EmpRank[员工排行]
        Billing[部门分账]
        Channels[渠道管理]
        Prices[模型价格]
        Quotas[限额设置]
        Alerts[预警记录]
        Logs[操作日志]
        Perms[权限管理]
    end

    Admin --> Usage & Key & Overview & DeptRank & EmpRank & Billing & Channels & Prices & Quotas & Alerts & Logs & Perms
    Finance --> Usage & Key & Overview & Billing
    DeptMgr --> Usage & Key & DeptRank & EmpRank & Billing
    Member --> Usage & Key

    style Admin fill:#fef3c7,stroke:#d97706
    style Finance fill:#dcfce7,stroke:#16a34a
    style DeptMgr fill:#e0f2fe,stroke:#0284c7
    style Member fill:#f3f4f6,stroke:#6b7280
```

```mermaid
flowchart TD
    Req[用户请求] --> MW{Edge Middleware}
    MW -->|公开路由<br/>/api/auth/*<br/>/api/health| Allow1[✅ 放行]
    MW -->|页面路由<br/>/dashboard/*| JWT{JWT 有效?}
    JWT -->|否| Login[❌ 重定向 /login]
    JWT -->|是| Allow2[✅ 放行]
    MW -->|管理 API<br/>/api/admin/*| JWT2{JWT + Admin?}
    JWT2 -->|否| Deny[❌ 403 Forbidden]
    JWT2 -->|是| Allow3[✅ 放行]
    MW -->|内部 API<br/>/api/internal/*| APIKey{INTERNAL_API_KEY?}
    APIKey -->|否| Deny2[❌ 401]
    APIKey -->|是| Allow4[✅ 放行]

    style Deny fill:#fee2e2,stroke:#dc2626
    style Deny2 fill:#fee2e2,stroke:#dc2626
    style Login fill:#fef3c7,stroke:#d97706
```

---

## 六、预警系统流程

```mermaid
flowchart TD
    subgraph 触发源
        T1[每次 AI 请求<br/>quota-alert]
        T2[定时异常检测<br/>每小时]
        T3[定时余额同步<br/>04:00]
        T4[定时状态检查<br/>20:00]
        T5[手动排行榜<br/>10:00]
    end

    subgraph 预警路由器
        NR[notification-router.ts<br/>总开关 → 类型开关 → 接收人]
    end

    subgraph 通知渠道
        F1[飞书私聊卡片]
        F2[飞书群卡片]
    end

    T1 --> NR
    T2 --> NR
    T3 --> NR
    T4 --> NR
    T5 --> NR

    NR -->|personal_80/100| F1
    NR -->|dept_80| F1
    NR -->|company_90| F1
    NR -->|anomaly| F1
    NR -->|balance_low| F1
    NR -->|employee_departed| F1
    NR -->|leaderboard| F2

    subgraph alert_settings 表
        S1[personal_threshold: 80]
        S2[feishu_notify_enabled: true]
        S3[notify_recipients_*: ...]
    end

    NR -.->|读取配置| S1 & S2 & S3

    style NR fill:#fef3c7,stroke:#d97706
    style F1 fill:#dcfce7,stroke:#16a34a
    style F2 fill:#dcfce7,stroke:#16a34a
```

---

## 七、Docker 部署架构

```mermaid
graph TB
    subgraph 服务器
        subgraph Docker Compose
            subgraph proxy 容器
                P1[Hono 网关<br/>端口 3001]
            end
            subgraph web 容器
                W1[Next.js 服务<br/>端口 3000]
                W2[定时任务调度器<br/>auto-sync.ts]
            end
            subgraph 共享 Volume
                V1[(app-data volume<br/>/data/data.db)]
            end
        end
        Nginx[Nginx / Caddy<br/>反向代理]
    end

    Internet[🌐 互联网] -->|HTTPS| Nginx
    Nginx -->|/| W1
    Nginx -->|/v1/*| P1
    Nginx -->|/api/proxy/*| P1
    P1 --> V1
    W1 --> V1
    W2 -->|INTERNAL_API_KEY| W1

    style Internet fill:#e0f2fe,stroke:#0284c7
    style V1 fill:#fef3c7,stroke:#d97706
    style Nginx fill:#f3f4f6,stroke:#6b7280
```

---

## 八、飞书数据同步流程

```mermaid
flowchart TD
    Start[触发同步] --> Mig[数据库迁移<br/>确保列完整]
    Mig --> Dept[拉取飞书部门列表]
    Dept --> Classify[三级分类<br/>center / department / group]
    Classify --> Users[收集所有部门下的用户]
    Users --> Upsert[findOrCreateUser<br/>upsert 用户记录]

    Upsert --> HasAPIKey{已有 API Key?}
    HasAPIKey -->|否| GenKey[生成 sk-emp-xxxxxx<br/>AES-256-GCM 加密存储<br/>HMAC-SHA256 哈希索引]
    HasAPIKey -->|是| Skip[跳过]

    GenKey --> Normalize
    Skip --> Normalize[normalizeAndProtect<br/>部门名规范化 + 管理员保护]

    Normalize --> Map1[GROUP_TO_DEPT<br/>小组名 → 部门]
    Normalize --> Map2[DEPT_RENAME<br/>不规范名修正]
    Normalize --> Map3[USER_DEPT_OVERRIDE<br/>个别用户强制归属]
    Normalize --> Protect[HARDCODED_ADMIN_IDS<br/>何广明 + 陈四华<br/>不被降级]

    Normalize --> Cleanup[cleanupDepartedAndSeed<br/>停用离职员工]
    Cleanup --> Done[✅ 同步完成]

    style Start fill:#dbeafe,stroke:#2563eb
    style Done fill:#dcfce7,stroke:#16a34a
    style Protect fill:#fef3c7,stroke:#d97706
```

---

## 九、安全架构

```mermaid
flowchart LR
    subgraph 传输层
        HSTS[HSTS Strict-Transport-Security]
        CSP[Content-Security-Policy]
        XFO[X-Frame-Options: DENY]
    end

    subgraph 认证层
        JWT_AUTH[JWT HS256<br/>HttpOnly Cookie<br/>30天有效期]
        API_AUTH[API Key<br/>Bearer sk-emp-xxx<br/>HMAC-SHA256 哈希查找]
        CSRF[CSRF State<br/>timingSafeEqual 验证]
    end

    subgraph 存储层
        AES[AES-256-GCM<br/>API Key 加密存储]
        HMAC[HMAC-SHA256<br/>不可逆哈希索引]
        EnvProd[生产环境<br/>JWT_SECRET 必须≠默认值]
    end

    subgraph 访问控制
        RBAC[4 级角色<br/>admin/finance/dept_manager/member]
        Protected[HARDCODED_ADMIN_IDS<br/>管理员角色保护]
        AdminAPI[Admin API<br/>双重检查中间件+API]
    end

    HSTS & CSP & XFO --> Secure[🔒 安全防护]

    style Secure fill:#dcfce7,stroke:#16a34a
```
