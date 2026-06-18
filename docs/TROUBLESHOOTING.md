# 故障排查手册

最后更新：2026-06-18

本文档按现象列出排查步骤。

## 1. 员工无法飞书授权

现象：

- “你没有 Sparkloom 的使用权限”
- 授权按钮灰色
- 授权后回登录页

排查：

1. 飞书开放平台检查应用可用范围是否包含该员工。
2. 检查 `FEISHU_REDIRECT_URI` 是否包含 `https://ai.seapllo.com/api/auth/feishu/callback`。
3. 检查 Railway 变量 `FEISHU_APP_ID` 和 `NEXT_PUBLIC_FEISHU_APP_ID` 是否一致。
4. 检查 `NEXT_PUBLIC_FEISHU_REDIRECT_URI` 是否和飞书后台完全一致。
5. 后台查看 `users.status` 是否为 `active`。
6. 查看日志中是否有 `invalid_state`、`feishu_config`、`account_disabled`。

## 2. 登录后还是回登录页

排查：

1. 确认 `JWT_SECRET` 已配置且不是默认值。
2. 确认浏览器可以保存 `token` HttpOnly cookie。
3. 确认 Railway 入口传递了 `x-forwarded-proto=https`。
4. 检查用户是否被飞书同步标记为 `disabled`。
5. 检查 `getFreshSession()` 是否能从 DB 查到用户。

## 3. 员工 Key 复制出来带星号

这是正常安全设计。

规则：

- 创建成功时只显示一次明文。
- 后续只展示脱敏值。
- 忘记后必须新建。

如果“第一次也无法复制”：

1. 检查前端是否使用 POST 响应里的 `apiKey` 字段。
2. 检查 GET 列表是否误当成明文来源。
3. 检查 `user_api_keys` 是否因为旧迁移留下默认 Key；当前启动逻辑会清理默认 Key。

相关代码：

- `web/src/app/api/user/key/route.ts`
- `web/src/lib/user-api-keys.ts`

## 4. API 返回 401 Authentication Fails

如果错误里显示 `****a08f`，通常是把脱敏 Key 当真实 Key 填进客户端。

排查：

1. 确认客户端 Key 是完整 `sk-emp-...`。
2. 不要填写 DeepSeek 官方 Key。
3. 不要填写带星号的脱敏 Key。
4. 删除旧 Key 后新建一个，再立即复制。
5. 调用：

```bash
curl https://ai.seapllo.com/v1/models \
  -H "Authorization: Bearer sk-emp-完整key"
```

## 5. API 返回 429 Monthly personal quota exceeded

原因可能不是页面百分比达到 100%，而是预占额度触发。

排查：

1. 查用户本月 `usage_logs` 费用。
2. 查用户未过期 `quota_reservations`。
3. 检查 `QUOTA_RESERVATION_TTL_SECONDS`，默认 600 秒。
4. 检查请求是否设置了很大的 `max_tokens` 或 `max_completion_tokens`。
5. 检查模型价格是否异常偏高。

规则：

- Proxy 请求前按输入估算和输出 token 预占费用。
- 如果 `used + reserved >= limit`，直接 429。
- 请求成功落 usage 后会删除 reservation。
- 上游失败会释放 reservation。

## 6. 计费金额明显偏高

排查：

1. 到模型价格页确认模型价格。
2. 确认渠道币种是 CNY 还是 USD。
3. 确认汇率接口返回是否异常。
4. 检查 usage 中 `input_tokens`、`output_tokens`、`cached_tokens`。
5. 确认上游是否返回 usage。
6. 流式请求如无 usage，系统会按字符估算输出 token。

费用公式：

```text
费用 = ((inputTokens - cachedTokens) * inputPrice
      + cachedTokens * cachePrice
      + outputTokens * outputPrice) / 1_000_000
```

USD 价格会按 USD/CNY 汇率换算成人民币。

## 7. 模型价格同步显示更新 15 条，但页面只显示 6 条

可能原因：

- 页面过滤了渠道或供应商。
- 有些模型属于渠道专属价格，不在当前筛选下显示。
- 被删除过的模型在 `sync_blacklist` 中。
- 手动价格 `synced_at=null`，官方同步不会覆盖。
- 官方抓取失败时使用 fallback，但 fallback 不覆盖已有价格。

排查：

1. 查 `/api/admin/prices?includeExchangeRate=true` 返回总数。
2. 看 `sourceSummary` 和 `warnings`。
3. 查 `model_prices.channel_id` 是否为空或绑定不同渠道。
4. 查 `sync_blacklist`。

## 8. 渠道管理里模型调用失败

排查：

1. 渠道状态是否 `active`。
2. 渠道模型列表是否包含请求模型。
3. 该渠道和模型是否有价格。
4. Base URL 是否供应商 OpenAI 兼容根地址。
5. 供应商 Key 是否完整明文重新录入过。
6. 上游是否返回 401/403。
7. 是否被 SSRF 校验拒绝。

内部渠道读取逻辑会过滤：

- 非 active 渠道。
- 模型不匹配渠道。
- 没有价格的模型。

## 9. 硅基流动余额显示不对

当前解析优先级：

1. `availableBalance`
2. `chargeBalance`
3. `balance`
4. `totalBalance`

系统优先选择非负现金余额，避免优惠/赠送/欠费字段导致误报。

排查：

1. 供应商控制台确认可用余额字段含义。
2. 后台把渠道设置为 `auto` 同步。
3. 手动新建 Key 后重新录入完整明文。
4. 触发单渠道余额同步。
5. 如仍不一致，抓取接口原始响应，但不得记录完整 API Key。

## 10. 禁用渠道仍然显示余额不足

当前代码要求：

- `syncChannelBalances()` 跳过 disabled 渠道。
- `collectLowBalanceAlert()` 跳过 disabled 渠道。
- `refreshCurrentAlerts()` 发送前复核 disabled 渠道。
- 全局概览应只统计启用渠道余额。

排查：

1. 刷新页面确认状态已保存。
2. 等待余额提醒发送前复核。
3. 检查是否是旧 `alert_logs` 历史记录，不是当前状态。
4. 检查全局概览 API 是否过滤 `channels.status='active'`。

## 11. 飞书群组列表为空

排查：

1. 确认机器人已加入目标群。
2. 确认飞书应用有获取群列表权限。
3. 手动刷新群组。
4. 检查 `/api/admin/feishu/chats`。
5. 确认机器人没有被移出群或群已解散。

## 12. 发送测试排行榜没有生效

排查：

1. 排行榜总开关是否开启。
2. 是否选择群组。
3. 机器人是否在群里。
4. 飞书消息权限是否开启。
5. `/api/admin/leaderboard-send` 返回 `sent` 和 `failed`。
6. 如果本月没有 usage，测试时是否允许空数据。

## 13. 飞书同步误判大量离职

保护机制：

- 如果部门用户拉取失败，会跳过自动停用。
- 如果拉取人数下降超过 `FEISHU_MAX_AUTO_DISABLE_DEPARTED`，会跳过自动停用。

排查：

1. 查看同步结果 `failedDepartments`。
2. 查看 `departedCandidates` 和 `skippedDeparted`。
3. 临时调小风险：设置 `FEISHU_MAX_AUTO_DISABLE_DEPARTED=0` 禁止自动停用。
4. 检查飞书应用通讯录数据范围。
5. 检查应用权限是否完整。

## 14. 全局概览加载慢或 500

排查：

1. 看 Railway 日志中的 SQL 或 route 错误。
2. 确认 `usage_logs` 索引已创建。
3. 确认 DB 可读写。
4. 确认没有同步任务长时间占用请求。
5. 调用 `/api/health`。
6. 检查 overview route 是否处理空数据、disabled 渠道、null 余额。

## 15. `/health` 返回 degraded

排查：

1. 详细调用 Web `/api/health`。
2. 检查缺失环境变量。
3. 检查关键表是否缺失。
4. 检查 DB 是否可写。
5. 检查 Proxy usage 队列路径是否可写。

## 16. 上游请求全失败

排查：

1. `/v1/models` 是否能返回模型。
2. 对应渠道是否 active。
3. 对应模型是否有价格。
4. 渠道 Key 是否完整。
5. Base URL 是否正确。
6. Proxy 是否能访问 Web 内部接口。
7. `INTERNAL_API_KEY` 是否两边一致。
