# 渠道余额同步系统 — 模块总结文档

> 归档日期：2026-06-06
> 状态：✅ 全部 6 Phase 已实现，tsc --noEmit 编译零错误

---

## 一、功能概述

管理员可从全局查看各渠道（DeepSeek、硅基流动、阿里千问等）的账号余额，及时发现余额不足的渠道。

- **自动同步**：DeepSeek、硅基流动、阿里千问 通过 API 自动获取余额
- **手动填写**：OpenAI、Anthropic、GLM 等无余额 API 的供应商，由管理员手动录入
- **阈值告警**：余额低于阈值时页面显示黄/红警告标签，并通过飞书 Webhook 发送告警卡片
- **定时同步**：每天 04:00 自动执行余额同步，服务器启动 60 秒后也会初始同步一次

---

## 二、供应商余额 API 调研

| 供应商 | 余额 API | 端点 | 认证方式 | 返回字段 |
|--------|---------|------|---------|---------|
| DeepSeek | ✅ | `GET {baseUrl}/user/balance` | Bearer token | `balance_infos[0].total_balance` |
| 硅基流动 | ✅ | `GET {baseUrl}/v1/user/info` | Bearer token | `data.totalBalance` |
| 阿里千问 | ✅ | 阿里云 BssOpenApi `QueryAccountBalance` | HMAC-SHA1 签名 (AccessKey ID + Secret) | `Data.AvailableAmount` |
| OpenAI | ❌ | — | 手动填写 | — |
| Anthropic | ❌ | — | 手动填写 | — |
| GLM | ❌ | — | 手动填写 | — |

---

## 三、文件清单

### 3.1 Schema 定义

| 文件 | 操作 | 说明 |
|------|------|------|
| `shared/schema.ts` | 改 | channels 表新增 7 个余额相关字段 |

**新增字段：**
```typescript
balance: real("balance")                                       // 当前余额（null=从未同步）
balanceCurrency: text("balance_currency")                      // 余额币种 "CNY"|"USD"
balanceSyncMode: text("balance_sync_mode")                     // "auto"|"manual"|null
balanceSyncedAt: integer("balance_synced_at", { mode: "timestamp" })  // 最后同步时间
balanceAlertThreshold: real("balance_alert_threshold")         // 单渠道预警阈值
accessKeyId: text("access_key_id")                             // 阿里云 AK ID
accessKeySecret: text("access_key_secret")                     // 阿里云 AK Secret（加密存储）
```

### 3.2 核心模块

| 文件 | 操作 | 行数 | 说明 |
|------|------|------|------|
| `web/src/lib/balance-sync.ts` | **新建** | 478 | 余额获取 + 阈值检查 + 飞书告警格式化 + 余额概览 |

**导出函数：**
- `syncChannelBalances(channelId?)` — 核心同步函数，按供应商分发获取余额
- `formatBalanceAlert(alerts)` — 格式化告警消息文本
- `sendBalanceAlert(alerts)` — 发送飞书 Webhook 告警卡片
- `getBalanceOverview()` — 获取所有渠道余额概览（供 overview API 使用）

**内部函数：**
- `fetchDeepSeekBalance(baseUrl, apiKey)` — DeepSeek 余额获取
- `fetchSiliconFlowBalance(baseUrl, apiKey)` — 硅基流动余额获取
- `fetchAlibabaBalance(accessKeyId, accessKeySecret)` — 阿里云 BSS API（HMAC-SHA1 签名）
- `percentEncode(str)` — 阿里云 RPC 签名用 RFC 3986 编码

### 3.3 API 端点

| 文件 | 操作 | 说明 |
|------|------|------|
| `web/src/app/api/admin/channels/balance-sync/route.ts` | **新建** | `POST` 手动触发余额同步 |
| `web/src/app/api/admin/channels/route.ts` | 改 | `ensureBalanceColumns` 迁移 + `PUT` 支持余额字段更新 |
| `web/src/app/api/admin/overview/route.ts` | 改 | `GET` 新增 `balanceSummary`（需 `includeBalance=true` 参数） |

**API 接口：**

```
POST /api/admin/channels/balance-sync
  Body: { channelId?: string }    // 不传=同步所有自动渠道
  Response: { synced: number, failed: number, alerts: ChannelAlert[] }

PUT /api/admin/channels
  Body: { id, balance?, balanceCurrency?, balanceSyncMode?, balanceAlertThreshold?, accessKeyId?, accessKeySecret? }

GET /api/admin/overview?includeBalance=true
  Response: { ..., balanceSummary: { channels, totals: { CNY, USD }, alerts } }
```

### 3.4 前端页面

| 文件 | 操作 | 行数 | 说明 |
|------|------|------|------|
| `web/src/app/dashboard/admin/channels/page.tsx` | 改 | 470 | 余额列 + 刷新按钮 + 手动填写 + 预警标签 |
| `web/src/app/dashboard/admin/page.tsx` | 改 | 399 | 余额告警横幅 + 汇总卡片 + 余额表格 |

**渠道管理页 UI 元素：**
- 表格新增「余额」列 — 有余额显示金额+币种，auto 渠道显示"待同步"，manual 渠道显示输入框
- 余额状态标签 — 绿色正常 / 黄色偏低 / 红色严重不足
- 🔄 刷新余额按钮（每行 auto 渠道）
- 🔄 同步所有余额按钮（页面顶部）
- 同步时间显示

**概览页 UI 元素：**
- 红色告警横幅（有 danger 级别渠道时）
- 黄色警告横幅（仅有 warning 级别时）
- 汇总卡片 — CNY 总余额、USD 总余额、低余额预警数、监控渠道数
- 余额表格 — 渠道名、供应商、余额、状态标签、同步时间

### 3.5 定时任务

| 文件 | 操作 | 说明 |
|------|------|------|
| `web/src/lib/auto-sync.ts` | 改 | 新增余额定时同步（每天 04:00）+ 启动初始同步 |

**调度时间表：**
- 03:00 — 价格同步
- 04:00 — 余额同步（价格同步之后 1 小时，避免并发）
- 12:00 / 19:00 — 飞书员工数据同步
- 启动 30 秒后 — 价格初始同步
- 启动 60 秒后 — 余额初始同步

---

## 四、阈值检查逻辑

```
默认阈值: CNY=100, USD=10
渠道阈值: balanceAlertThreshold > 全局默认 > 硬编码

severity 判断:
  balance < threshold * 0.2  → "danger"（红色）
  balance < threshold        → "warning"（黄色）
  balance >= threshold       → 正常（绿色）
```

---

## 五、数据流

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│  定时调度     │────→│  balance-sync │────→│  供应商 API     │
│  auto-sync   │     │  route.ts    │     │  DeepSeek/SF/  │
│  每天 04:00  │     │  POST /sync  │     │  Alibaba       │
└─────────────┘     └──────┬───────┘     └────────────────┘
                           │
                    ┌──────▼───────┐
                    │ balance-sync │
                    │ .ts 核心模块  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      ┌──────────┐  ┌──────────┐  ┌──────────┐
      │ 更新 DB   │  │ 阈值检查  │  │ 飞书告警  │
      │ channels │  │ alerts   │  │ Webhook  │
      └──────────┘  └──────────┘  └──────────┘
              │            │
              ▼            ▼
      ┌──────────┐  ┌──────────────┐
      │ 渠道管理页 │  │  全局概览页   │
      │ 余额显示   │  │ 余额汇总卡片  │
      └──────────┘  └──────────────┘
```

---

## 六、安全相关

- API Key 和 AccessKey Secret 使用 AES-256-GCM 加密存储（`enc:v1:` 前缀）
- 前端返回时 API Key 脱敏（`前8位****`）
- 阿里云 AccessKey Secret 同样加密存储，编辑时留空=不修改
- 所有余额同步 API 端点需 admin 角色认证
- API 请求使用 `apiHandler` 统一错误处理

---

## 七、验证状态

- [x] TypeScript 编译零错误（`tsc --noEmit`）
- [x] Schema 迁移 — 启动自动 `ALTER TABLE ADD COLUMN`，幂等安全
- [x] DeepSeek 余额获取逻辑完整
- [x] 硅基流动余额获取逻辑完整
- [x] 阿里云 BSS API HMAC-SHA1 签名逻辑完整
- [x] 手动余额填写（无 API 的渠道）
- [x] 阈值检查 + 告警级别判断
- [x] 飞书 Webhook 告警卡片发送
- [x] 定时调度（04:00 + 启动同步）
- [x] 渠道管理页余额列 UI
- [x] 全局概览页余额汇总 UI
- [ ] 浏览器功能测试（需人工启动 dev server 验证）
