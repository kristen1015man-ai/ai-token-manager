# 监控和告警

最后更新：2026-06-18

本文档定义生产运行需要观察的健康指标、日志和告警。

## 1. 健康检查

公网：

```bash
curl https://ai.seapllo.com/health
```

内部详细：

```bash
curl -H "Authorization: Bearer $INTERNAL_API_KEY" http://127.0.0.1:3000/api/health
curl -H "Authorization: Bearer $INTERNAL_API_KEY" http://127.0.0.1:3001/health
```

Web degraded 常见原因：

- 缺 `JWT_SECRET`。
- 缺 `INTERNAL_API_KEY`。
- 缺 `ENCRYPTION_KEY`。
- 缺飞书配置。
- DB 不可读。
- DB 不可写。
- 关键表缺失。

Proxy degraded 常见原因：

- `INTERNAL_API_KEY` 未配置。
- Web health 不通。
- usage queue 路径不可写。

## 2. 必看日志关键词

| 关键词 | 含义 |
| --- | --- |
| `[railway]` | 入口层转发、进程启动、配置缺失 |
| `[ensureTables]` | DB 表结构检查和迁移 |
| `[AutoSync]` | 定时任务 |
| `[BalanceSync]` | 渠道余额同步 |
| `[PriceSync]` | 模型价格同步 |
| `[Usage]` | Proxy usage 队列和 flush |
| `[InternalAPI]` | 内部 usage 或 quota 错误 |
| `[Feishu]` | 飞书 OAuth/API |
| `[FeishuBot]` | 飞书机器人消息 |
| `[NotificationRouter]` | 通知路由 |
| `[QuotaAlerts]` | 额度提醒 |
| `[Proxy]` | 上游转发、估算 usage、流式异常 |

## 3. API 指标

建议监控：

- `/v1/chat/completions` 请求数。
- 401 数量和比例。
- 429 数量和比例。
- 500/502 数量和比例。
- 平均响应时间。
- 流式连接中断数。
- `/v1/models` 是否正常。

异常判断：

- 401 突增：员工 Key 配置错误或认证链路异常。
- 429 突增：额度配置过低、reservation 未释放、价格异常。
- 502 突增：上游供应商故障、渠道 Key 失效、网络问题。

## 4. 计费指标

建议每天检查：

- `usage_logs` 当日新增数量。
- 当日总费用。
- 分渠道费用。
- 分模型费用。
- 单用户小时费用峰值。
- usage queue pending 数量。
- dead-letter 新增数量。

风险：

- queue pending 持续增长：Web 内部 usage 接口异常。
- dead-letter 新增：价格缺失或 usage 数据被 Web 拒绝。
- 单用户费用突增：异常调用或 Key 泄露。

## 5. 余额指标

建议监控：

- 启用渠道当前余额。
- 余额同步失败数。
- 余额告警数。
- danger 数量。
- 上次同步时间。

disabled 渠道不应纳入当前余额风险。

## 6. 飞书同步指标

每次同步关注：

- `totalUsers`
- `created`
- `updated`
- `reactivated`
- `departedCandidates`
- `disabledDeparted`
- `skippedDeparted`
- `failedDepartments`

异常：

- `failedDepartments > 0`：通讯录权限或接口异常。
- `departedCandidates` 大幅上升：飞书数据范围可能变小。
- `skippedDeparted` 大于 0：保护机制生效，需要人工确认。

## 7. 通知指标

关注：

- 飞书通知总开关。
- 各通知类型开关。
- 接收人是否为空。
- 机器人所在群列表是否可刷新。
- 排行榜发送成功数。

`notifyAlert()` 返回：

- `sent`
- `skipped`

`sent=0` 常见原因：

- 总开关关闭。
- 类型未启用。
- 无接收人。
- 飞书 API 权限不足。

## 8. 页面性能

重点页面：

- 全局概览。
- 渠道管理。
- 模型价格。
- 员工排行。
- 部门分账。

如果加载慢：

1. 查对应 API 响应时间。
2. 查 DB 聚合是否使用索引。
3. 检查是否同时执行飞书/价格/余额同步。
4. 检查页面是否拉取了完整明细而非分页。

## 9. 告警建议

建议平台层配置：

- `/health` 连续 3 次非 200 告警。
- 5xx 比例超过 5% 告警。
- 429 比例异常上升告警。
- usage queue pending 大于 100 告警。
- dead-letter 有新增告警。
- 启用渠道余额 danger 告警。
- 飞书同步 failedDepartments 大于 0 告警。

## 10. 健康检查边界

`/health` 只能证明入口进程和基础依赖可用，不能证明业务全链路一定正常。

必须额外验证：

- 飞书 OAuth 登录。
- `/v1/models`。
- 一次小额 chat 调用。
- usage 入库。
- 渠道余额同步。
- 飞书通知发送。

如果 `/health` 为 ok 但用户仍不可用，按 `TROUBLESHOOTING.md` 从登录、权限、Key、渠道和限额链路继续排查。

## 11. Railway 日志查询模板

优先按关键词过滤：

```text
[railway]
[ensureTables]
[AutoSync]
[BalanceSync]
[PriceSync]
[Usage]
[InternalAPI]
[Feishu]
[FeishuBot]
[NotificationRouter]
[QuotaAlerts]
[Proxy]
```

常见排查组合：

- 登录失败：`[Feishu]`, `invalid_state`, `account_disabled`, `callback`
- 计费失败：`[Usage]`, `[InternalAPI]`, `dead-letter`, `Flush error`
- 渠道失败：`[Proxy]`, `upstream`, `401`, `403`, `502`
- 余额错误：`[BalanceSync]`, `provider`, `balance`, `failed`
- 通知没发：`[NotificationRouter]`, `[FeishuBot]`, `sent=0`, `skipped`

日志中不得出现完整员工 Key、供应商 Key、`FEISHU_APP_SECRET`、`INTERNAL_API_KEY` 或 `ENCRYPTION_KEY`。一旦出现，按 `INCIDENT-RUNBOOK.md` 的密钥泄露流程处理。

## 12. 告警分级

| 级别 | 条件 | 响应 |
| --- | --- | --- |
| P0 | 资金异常扣费、密钥泄露、全员无法登录、全员 API 不可用、DB 损坏 | 立即止血，通知甲方负责人，必要时禁用渠道或回滚 |
| P1 | 大量 5xx/502、usage queue 持续增长、余额同步全失败、飞书同步误判离职 | 30 分钟内处理，必要时关闭自动任务 |
| P2 | 单个供应商异常、部分员工登录失败、排行榜或通知失败 | 当日处理，记录原因和修复 |
| P3 | 页面慢、文案问题、非关键统计延迟 | 排期修复 |

资金、密钥、权限、DB 相关问题默认至少按 P1 处理；出现实际损失或泄露时升级 P0。

## 13. 财务和计费监控口径

每天至少核对一次：

- 供应商控制台余额与 Sparkloom 渠道余额是否一致。
- 当日总费用与供应商实际扣费是否同量级。
- 是否出现异常高单价模型或异常高 token。
- 是否有 `fallback` 价格参与计费。
- 是否使用过过期汇率或兜底汇率。

如果 Sparkloom 费用明显高于供应商扣费，优先检查：

- 模型价格单位是否按“每百万 token”录入。
- 缓存命中 token 是否走 cache price。
- 上游 usage 是否缺失导致估算。
- 汇率是否异常。

## 14. 飞书通知交付限制

系统只能确认调用飞书发送接口是否成功，不能证明每个接收人已经阅读。

排查提醒未收到时，按顺序确认：

1. 通知总开关和类型开关。
2. 接收人或群组配置。
3. 机器人是否在群里。
4. 飞书应用消息权限。
5. 飞书 API 返回码。
6. 用户是否被飞书免打扰、离职或不可见。

严重余额、费用或密钥事故不能只依赖飞书通知，应同步电话或公司应急群确认。
