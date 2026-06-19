# 数据库说明

最后更新：2026-06-18

Sparkloom 使用 sql.js SQLite。Schema 定义在 `shared/schema.ts`，运行时兼容迁移在 `web/src/lib/ensure-tables.ts`。

## 1. 数据库文件

路径优先级：

1. `DATABASE_URL` 是文件路径时使用该路径。
2. `RAILWAY_VOLUME_MOUNT_PATH` 存在时使用 `${RAILWAY_VOLUME_MOUNT_PATH}/data.db`。
3. 默认 `./data.db`。

生产必须使用持久卷。

写入方式：

- `saveDb()`：立即导出内存 DB 到文件。
- `scheduleSave()`：2 秒 debounce 后保存。
- 进程退出前尽量 flush。

## 2. `users`

用户主表。

重要字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 系统内部用户 ID |
| `feishu_id` | 飞书 open_id，唯一 |
| `name` | 姓名 |
| `avatar` | 头像 |
| `email` | 邮箱 |
| `department`, `department_id` | 标准部门 |
| `group_name`, `group_id` | 组 |
| `center_name`, `center_id` | 中心 |
| `employee_id` | 工号 |
| `api_key` | 兼容字段，当前主 Key 加密值 |
| `api_key_hash` | 当前主 Key hash |
| `role` | 逗号分隔角色 |
| `status` | `active` 或 `disabled` |
| `monthly_quota` | 个人月度额度 |

注意：

- 新员工 Key 主要存在 `user_api_keys`。
- `api_key` 和 `api_key_hash` 为兼容旧逻辑保留。
- `status=disabled` 用户不能登录或调用 API。

## 3. `user_api_keys`

员工 API Key 表。

字段：

| 字段 | 说明 |
| --- | --- |
| `id` | Key ID |
| `user_id` | 归属用户 |
| `key_hash` | HMAC-SHA256 可搜索 hash |
| `key_encrypted` | AES-GCM 加密后的 Key |
| `masked_key` | 展示用脱敏值 |
| `name` | Key 名称 |
| `created_at` | 创建时间 |
| `last_used_at` | 最近使用时间 |

规则：

- `key_hash` 唯一。
- 明文不持久化。
- 每个用户至少保留一个 Key。

## 4. `channels`

上游供应商渠道表。

字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 渠道 ID |
| `name` | 渠道名称 |
| `base_url` | 上游 Base URL |
| `api_key` | 上游 API Key 加密值 |
| `models` | JSON 模型数组 |
| `priority` | 优先级，数字越小越优先 |
| `status` | `active` 或 `disabled` |
| `currency` | 渠道币种 |
| `provider` | deepseek/siliconflow/alibaba/openai/anthropic/glm 等 |
| `balance` | 当前余额 |
| `balance_currency` | 余额币种 |
| `balance_sync_mode` | `auto`/`manual`/null |
| `balance_synced_at` | 最近同步时间 |
| `balance_alert_threshold` | 单渠道余额阈值 |
| `access_key_id` | 阿里云 AK |
| `access_key_secret` | 阿里云 SK 加密值 |

规则：

- disabled 渠道不参与调用。
- disabled 渠道不参与余额告警。
- 内部渠道接口只返回 active 且有价格的模型。

## 5. `model_prices`

模型价格表。

字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 价格 ID |
| `model` | 模型名 |
| `channel_id` | 渠道 ID，null 表示全局价格 |
| `input_per_million` | 每百万输入 token 价格 |
| `output_per_million` | 每百万输出 token 价格 |
| `cache_per_million` | 每百万缓存命中 token 价格 |
| `display_name` | 展示名 |
| `currency` | CNY 或 USD |
| `deprecated` | 是否废弃 |
| `synced_at` | 官方同步时间；null 表示手动维护 |
| `updated_by` | 更新来源 |

唯一规则：

- `channel_id IS NULL` 时，`model` 唯一。
- `channel_id IS NOT NULL` 时，`channel_id + model` 唯一。

价格查找：

1. 先找 `(channelId, model)`。
2. 再找 `(null, model)`。
3. 都没有则阻断调用。

## 6. `sync_blacklist`

模型价格同步黑名单。

字段：

| 字段 | 说明 |
| --- | --- |
| `model` | 模型名 |
| `channel_id` | null 表示全局黑名单，非 null 表示渠道级 |
| `created_at` | 创建时间 |

删除价格时写入，防止官方同步把删除的模型加回来。

## 7. `usage_logs`

用量记录。

字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 记录 ID |
| `user_id` | 用户 |
| `model` | 模型 |
| `input_tokens` | 输入 token |
| `output_tokens` | 输出 token |
| `cached_tokens` | 缓存命中 token |
| `total_tokens` | 总 token |
| `cost` | 人民币费用 |
| `channel_id` | 渠道 |
| `created_at` | 创建时间 |

费用由 Web 在 `/api/internal/usage` 里根据价格表计算。

关键索引：

- `created_at`
- `user_id`
- `model`
- `channel_id`
- `model, created_at`
- `channel_id, created_at`
- `user_id, created_at`

## 8. `quota_rules`

额度规则。

字段：

| 字段 | 说明 |
| --- | --- |
| `scope` | `company` / `department` / `personal` |
| `target_id` | 目标 ID，公司规则可用固定值 |
| `monthly_limit` | 月额度 |
| `updated_by` | 更新人 |
| `updated_at` | 更新时间 |

规则：

- 个人额度同时回写 `users.monthly_quota`。
- `0` 表示硬阻断。

## 9. `quota_reservations`

额度预占表，运行时由 `ensure-tables` 和 quota check route 创建。

字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 预占 ID |
| `user_id` | 用户 |
| `department_id` | 部门 |
| `channel_id` | 渠道 |
| `model` | 模型 |
| `estimated_cost` | 预估费用 |
| `created_at` | 创建时间 |
| `expires_at` | 过期时间 |

用途：

- 请求发往上游前先预占费用。
- 避免并发请求绕过月额度。
- 请求成功落 usage 后删除。
- 上游失败或异常释放。
- 过期后自动清理。

## 10. `alert_settings`

预警配置。

常用 key：

- `personal_threshold`
- `dept_threshold`
- `company_threshold`
- `anomaly_threshold`
- `feishu_notify_enabled`
- `feishu_notify_types`
- `notify_recipients_balance_low`
- `notify_recipients_anomaly`
- `leaderboard_enabled`
- `leaderboard_chat_ids`
- `leaderboard_schedule`
- `leaderboard_send_day`

值均为字符串，数组用 JSON 字符串存储。

## 11. `alert_logs`

预警记录。

类型：

- `personal_80`
- `personal_100`
- `dept_80`
- `company_90`
- `anomaly`
- `balance_low`
- `employee_departed`
- `leaderboard`

## 12. `admin_logs`

管理员操作日志。

字段：

- `admin_id`
- `action`
- `target_type`
- `target_id`
- `detail`
- `created_at`

新增敏感操作应写入此表。

## 13. `system_flags`

系统迁移标记表。

当前用于：

- 记录是否执行过“用户 Key 必须显式新建”的清理迁移。

## 14. 迁移规范

- 表结构声明先改 `shared/schema.ts`。
- 兼容旧 DB 的运行时 DDL 写在 `web/src/lib/ensure-tables.ts`。
- 大表变更必须考虑锁和写盘。
- 涉及 `usage_logs` 的查询必须检查索引。
- 删除或重建表前必须备份 `data.db`。

当前真实迁移口径：

1. 类型声明改 `shared/schema.ts`。
2. 兼容已有 SQLite 文件的 DDL 写入 `web/src/lib/ensure-tables.ts`。
3. 如涉及历史数据修复，必须保证幂等，可重复执行。
4. 大表、删除列、重建表、批量 UPDATE 前必须备份 `data.db`。
5. 在生产 DB 副本上验证启动、`/api/health`、关键页面和一次真实 usage 写入。

注意：当前正式脚本只保留 `db:migrate`，它会执行 `shared/run-migrate.mjs` 并运行自定义幂等迁移脚本。不要使用临时 schema 生成物替代人工审查后的生产迁移。
