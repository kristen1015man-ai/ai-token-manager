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
