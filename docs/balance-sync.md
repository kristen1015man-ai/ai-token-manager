# 渠道余额同步

最后更新：2026-06-18

本文档描述渠道余额同步、阈值和飞书提醒逻辑。

## 1. 相关文件

- `web/src/lib/balance-sync.ts`
- `web/src/lib/balance-fetchers.ts`
- `web/src/lib/balance-sync-overview.ts`
- `web/src/app/api/admin/channels/balance-sync/route.ts`
- `web/src/lib/auto-sync.ts`
- `web/src/lib/notification-router.ts`

## 2. 支持的自动余额供应商

| provider | 自动余额 | 接口 |
| --- | --- | --- |
| `deepseek` | 支持 | `{baseUrl root}/user/balance` |
| `siliconflow` | 支持 | `{baseUrl root}/v1/user/info` |
| `alibaba` | 支持 | 阿里云 BSS `QueryAccountBalance` |
| `openai` | 不支持 | 手动余额 |
| `anthropic` | 不支持 | 手动余额 |
| `glm` | 不支持 | 手动余额 |

`inferAutoProvider()` 会根据 provider、渠道名、Base URL、ID 推断供应商。

## 3. 同步模式

字段：`channels.balance_sync_mode`

| 值 | 行为 |
| --- | --- |
| `auto` | 调供应商接口同步 |
| `manual` | 不调接口，只使用手动余额 |
| null | 自动供应商默认 auto，其他默认 manual |

disabled 渠道跳过同步和告警。

## 4. 阈值

字段：`channels.balance_alert_threshold`

如果为空，使用默认阈值：

| 币种 | 默认阈值 |
| --- | --- |
| CNY | 100 |
| USD | 10 |

严重等级：

- `warning`：余额低于阈值。
- `danger`：余额低于阈值的 20%。

当前同一批提醒只发一条卡片；如果批次里存在 danger，标题为“渠道余额告急”，否则为“渠道余额预警”。

## 5. 硅基流动余额解析

硅基流动接口字段可能包含多种余额。当前优先级：

1. `availableBalance`
2. `chargeBalance`
3. `balance`
4. `totalBalance`

系统优先选择非负现金余额，避免负的赠送/欠费字段影响提醒。

## 6. DeepSeek 余额解析

DeepSeek 使用：

- `balance_infos[0].total_balance`
- `balance_infos[0].currency`

如果接口返回 401/403，提示重新录入完整 DeepSeek Key。

## 7. 阿里云余额解析

需要：

- `access_key_id`
- `access_key_secret`

`access_key_secret` 加密存储。

调用：

- `business.aliyuncs.com`
- Action：`QueryAccountBalance`

## 8. 自动调度

配置：

- `BALANCE_SYNC_INTERVAL_MINUTES`，默认 60。
- `BALANCE_ALERT_TIMES`，默认 `09:30,12:00,14:30,17:30`。
- `BALANCE_ALERT_NOTIFY_ENABLED`，默认启用。

行为：

- 每小时余额同步，不发送飞书提醒。
- 固定提醒时间会同步并发送提醒。
- 所有时间按北京时间计算。

## 9. 发送前复核

`sendBalanceAlert()` 会在发送前重新查 DB：

- 渠道不存在则跳过。
- 渠道 disabled 则跳过。
- 余额为空则跳过。
- 余额已高于阈值则跳过。

这用于避免管理员手动修改余额后仍发送旧告警。

## 10. 手动触发

后台渠道管理可手动同步。

内部 curl：

```bash
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"notify":false}' \
  http://127.0.0.1:3000/api/internal/admin/channels/balance-sync
```

发送提醒：

```json
{ "notify": true }
```

## 11. 排查顺序

余额不对：

1. 渠道是否 active。
2. provider 是否正确。
3. sync mode 是否 auto。
4. Key 是否完整明文重新录入。
5. Base URL 是否供应商官方根地址。
6. 供应商接口是否返回余额字段。
7. 页面显示的是余额还是历史 alert log。

误报警：

1. 渠道是否已保存为 disabled。
2. 当前 `channels.balance` 是否仍低于阈值。
3. 当前阈值是否手动设得过高。
4. 是否是旧 alert log。
5. `BALANCE_ALERT_NOTIFY_ENABLED` 是否关闭。
