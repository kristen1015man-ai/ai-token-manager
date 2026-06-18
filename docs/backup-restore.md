# 备份、恢复和重置

最后更新：2026-06-18

本文档用于保护生产数据。Sparkloom 当前使用 SQLite 文件，备份恢复必须严格执行。

## 1. 需要备份的文件

生产核心文件：

- `/data/data.db`

计费队列文件：

- `/data/usage-queue.jsonl`
- `/data/usage-dead-letter.jsonl`

如果 Railway Volume 路径不是 `/data`，以实际 `RAILWAY_VOLUME_MOUNT_PATH` 为准。

## 2. 备份频率

建议：

- 每日自动备份一次。
- 每次发布前手动备份一次。
- 每次做数据清理、计费重置、DB 迁移前手动备份一次。
- 保留至少 14 天。

## 3. 备份内容

至少包含：

- `data.db`
- usage queue 文件。
- 当前 Railway 环境变量快照，敏感值可只记录是否存在和更新时间。
- 当前 Git commit。
- 备份时间，北京时间。

## 4. 手动备份步骤

1. 进入 Railway shell 或使用平台文件下载能力。
2. 确认应用低流量。
3. 调内部 flush：

```bash
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  http://127.0.0.1:3000/api/internal/admin/flush-db
```

4. 复制 `/data/data.db`。
5. 复制 queue 和 dead-letter 文件。
6. 保存到公司受控存储。

## 5. 恢复步骤

1. 停止线上服务或切维护窗口。
2. 备份当前 `/data/data.db`，不要直接覆盖。
3. 上传目标备份文件到 `/data/data.db`。
4. 确认文件权限可读写。
5. 重启服务。
6. 调用健康检查。
7. 登录后台核对：
   - 用户数。
   - 渠道数。
   - 模型价格数。
   - 本月 usage。
   - 余额。
8. 小流量测试 `/v1/models` 和一次 chat 调用。

## 6. 计费重置

计费重置会清空或重置用量数据，必须先备份。

内部接口：

- `POST /api/internal/admin/reset-billing`

使用场景：

- 测试期清空模拟计费。
- 正式上线前重新开始计费。

禁止：

- 在未备份时执行。
- 在不明确范围时执行。
- 在生产真实计费周期中随意执行。

## 7. 模拟数据清理

相关接口：

- `GET /api/admin/cleanup-preview`
- `POST /api/admin/cleanup-execute`

使用规范：

1. 先执行 preview。
2. 核对将删除的用户和记录。
3. 备份 DB。
4. 再执行 execute。

飞书同步本身也会清理非 `ou_` 的 seed 用户，并尝试转移 usage。

## 8. 飞书同步导致误停用的恢复

如果员工被误设为 `disabled`：

1. 先确认飞书应用数据范围。
2. 调整飞书应用权限或可用范围。
3. 手动执行飞书同步。
4. 如果同步仍未恢复，管理员可临时把用户状态改回 active。
5. 检查 `FEISHU_MAX_AUTO_DISABLE_DEPARTED` 是否过大。

建议在异常期设置：

```env
FEISHU_MAX_AUTO_DISABLE_DEPARTED=0
```

避免自动停用任何离职候选。

## 9. ENCRYPTION_KEY 恢复注意

`ENCRYPTION_KEY` 是解密生产 Key 的根密钥。

如果丢失或更换：

- 旧供应商 Key 无法解密。
- 旧员工 Key 无法校验。
- 需要重新录入供应商 Key。
- 员工需要新建 Key。

因此备份环境变量快照时必须确保 `ENCRYPTION_KEY` 有受控备份。

## 10. 恢复演练

建议每月至少一次：

1. 复制生产备份到临时环境。
2. 使用相同 `ENCRYPTION_KEY`。
3. 启动应用。
4. 验证登录、模型列表、渠道、价格、usage 查询。
5. 不要在临时环境发送真实飞书通知。
