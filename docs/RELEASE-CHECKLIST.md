# 上线前回归检查清单

最后更新：2026-06-18

本文档用于每次上线前验收。涉及资金、密钥、权限、计费、飞书同步的改动必须完整执行。

## 1. 构建检查

```bash
pnpm install --frozen-lockfile
pnpm --filter web build
pnpm --filter proxy build
pnpm --filter web lint
```

通过标准：

- lockfile 不漂移。
- Web 能构建。
- Proxy 能构建。
- TypeScript 无错误。

## 2. 环境变量检查

生产必须确认：

- `JWT_SECRET` 已配置且不是默认值。
- `ENCRYPTION_KEY` 已配置。
- `INTERNAL_API_KEY` 已配置。
- `FEISHU_APP_ID` 已配置。
- `FEISHU_APP_SECRET` 已配置。
- `FEISHU_REDIRECT_URI=https://ai.seapllo.com/api/auth/feishu/callback`。
- `NEXT_PUBLIC_FEISHU_REDIRECT_URI` 同上。
- `CORS_ALLOWED_ORIGINS=https://ai.seapllo.com`。
- `PUBLIC_PROXY_BASE_URL=https://ai.seapllo.com/v1`。
- 数据库使用持久卷。

## 3. 安全检查

- 仓库内没有真实飞书 Secret。
- 仓库内没有供应商 API Key。
- 仓库内没有员工 `sk-emp-` 明文 Key。
- `/api/internal/*` 公网返回 404。
- `/api/proxy/v1/*` 返回 410。
- 非 admin 访问 `/dashboard/admin/channels` 被重定向或拒绝。
- 非 admin 调用管理写 API 返回 403。
- Cookie 写 API 拒绝非同源请求。
- 渠道 Base URL 拒绝 localhost、私网和 metadata 地址。

## 4. 登录检查

- 管理员能用飞书登录。
- 普通员工能登录。
- 非应用可用范围用户不能登录。
- disabled 用户不能登录。
- 退出登录后不能访问 `/dashboard`。
- 修改用户角色后，刷新页面权限立即变化。

## 5. API Key 检查

- 新用户默认不展示可复制明文 Key。
- 新建 Key 后只在当次响应显示明文。
- 刷新后只显示脱敏 Key。
- 用脱敏 Key 调用 API 返回 401。
- 用完整 `sk-emp-...` 调用 `/v1/models` 成功。
- 删除 Key 时至少保留一个。
- 删除当前主 Key 后，剩余 Key 仍可使用。

## 6. 渠道检查

- 新建渠道必须录入完整供应商 Key。
- 保存脱敏 Key 被拒绝。
- 保存 `enc:v1:` 存储值被拒绝。
- 禁用渠道不会出现在 `/v1/models`。
- 禁用渠道不会被余额预警统计。
- 修改渠道模型后，`/v1/models` 30 秒内刷新。
- 配置主备渠道后，主渠道失败能 fallback。

## 7. 模型价格检查

- 手动新增价格后模型可调用。
- 缺价模型调用返回 422 或无可用渠道。
- 手动价格不会被官方同步覆盖。
- 删除模型价格后写入 `sync_blacklist`。
- 价格同步成功返回 updated/added/skipped/warnings。
- USD 价格按汇率换算。
- 缓存命中 token 使用 cache price。

## 8. 计费检查

非流式：

- `/v1/chat/completions` 成功返回。
- `usage_logs` 写入 input/output/total/cached/cost/channel/model。
- 员工今日和本月统计刷新。

流式：

- `stream=true` 正常返回 SSE。
- 请求体自动包含 `stream_options.include_usage=true`。
- 客户端中断时仍记录估算 usage。
- 上游无 usage 时记录估算 usage。

失败场景：

- Web 内部 usage 接口不可用时，Proxy 写入持久队列。
- 重启后 queue 文件能恢复并继续 flush。
- Web 拒绝记录时写入 dead-letter。

## 9. 限额检查

- 个人额度低于已用金额时调用返回 429。
- 部门额度用完时本部门员工返回 429。
- 公司额度用完时所有员工返回 429。
- `max_tokens` 很大时预占额度生效。
- 请求失败后 reservation 被释放。
- 成功落 usage 后 reservation 被删除。
- 个人阈值按后台配置通知，不是固定 80%。
- 未达阈值不通知。
- 达到 100% 发 personal_100。

## 10. 飞书检查

- 飞书登录成功。
- 飞书通讯录同步成功。
- 同步结果人数接近真实员工数量。
- 部门映射生效。
- 大量离职候选时自动停用被保护。
- 私聊测试消息成功。
- 机器人群列表能刷新。
- 排行榜测试能发送到选中群。

## 11. 余额检查

- DeepSeek 余额同步正确。
- 硅基流动余额同步正确。
- 手动余额能保存。
- disabled 渠道不触发预警。
- 余额低于阈值时进入 alerts。
- 余额恢复后发送前复核不再提醒。
- 提醒时间按北京时间。

## 12. 页面检查

- 登录页正常渲染，无明显卡顿。
- 顶部导航管理员标识正确。
- 品牌 Logo 透明底显示正常。
- `Sparkloom` 艺术字体不裁切。
- slogan 只在登录页需要的位置展示。
- 全局概览 5 秒内完成。
- 渠道管理 5 秒内完成。
- 模型价格 5 秒内完成。
- 移动端无明显重叠。

## 13. 运维检查

- `/health` 返回 ok。
- 内部 Web `/api/health` 详细检查 ok。
- Proxy `/health` 详细检查 ok。
- Railway Volume 可写。
- `/data/data.db` 已备份。
- usage queue 文件在持久卷。
- 重启后数据不丢。

## 14. 发布后观察

发布后 30 分钟内观察：

- Railway error 日志。
- 登录失败日志。
- Proxy 401/429/500/502 比例。
- usage queue pending 数量。
- balance sync failed 数量。
- 飞书同步 failedDepartments。
- 管理员收到异常通知数量。
