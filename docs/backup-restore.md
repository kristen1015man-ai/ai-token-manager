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

推荐先使用非破坏性内部备份接口生成一份带校验信息的备份：

```bash
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  http://127.0.0.1:3000/api/internal/admin/backup
```

该接口会：

- 先把内存 DB flush 到磁盘。
- 复制 `data.db`、`usage-queue.jsonl`、`usage-dead-letter.jsonl` 到 `/data/backups/handoff-<timestamp>/`。
- 对复制出来的 `data.db` 执行 `PRAGMA integrity_check`。
- 写入 `manifest.json`，记录文件大小、SHA-256、核心表数量和校验结果。

注意：

- 该接口只接受 `INTERNAL_API_KEY`，公网入口仍应被 `railway/start.mjs` 返回 404。
- 该接口只在 Railway Volume 内生成备份，不能替代下载到公司受控存储的灾备。
- 返回内容不得包含明文 Secret、员工 Key 或供应商 Key。

Railway SSH 不可用时，可使用一次性启动演练开关：

```env
RUN_BACKUP_DRILL_ON_START=true
BACKUP_DRILL_RUN_ID=20260620-operator
```

部署后在日志中查找：

```text
[BackupDrill] completed ...
```

日志摘要应包含：

- `backupDir`
- `manifestSha256`
- `dataDbSha256`
- `dataDbSize`
- `verification.integrity=ok`
- `users`、`channels`、`modelPrices`、`usageLogs` 等核心表数量

完成取证后必须删除 `RUN_BACKUP_DRILL_ON_START` 或改回 `false` 并重新部署，避免后续每次新部署都生成备份。

如果需要人工复制文件，执行以下步骤：

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
- `POST /api/admin/cleanup-execute`，仅非生产可用；生产环境固定返回 404

使用规范：

1. 先执行 preview。
2. 核对将删除的用户和记录。
3. 备份 DB。
4. 非生产可执行 execute；生产真实数据清理必须走审批后的离线脚本或受控维护流程，不允许临时打开 `ENABLE_CLEANUP_ENDPOINT`。

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

## 11. RPO 和 RTO

默认目标：

- RPO：最多丢失 24 小时数据；发布、清理、迁移、计费重置前的手动备份可把 RPO 收敛到操作前。
- RTO：常规 DB 恢复目标 2 小时内；密钥泄露、费用异常等安全事故按 `INCIDENT-RUNBOOK.md` 优先止血。

如果业务要求更低 RPO，必须把备份频率提高到每小时，并验证备份文件可以在临时环境启动。

## 12. 高风险操作审批

以下操作必须先获得甲方负责人明确批准，并记录操作者、时间、原因、备份文件和回滚方案：

- 恢复或覆盖 `/data/data.db`。
- 执行 `reset-billing`。
- 执行模拟数据清理。
- 修改 `ENCRYPTION_KEY`、`INTERNAL_API_KEY`、`JWT_SECRET`。
- 批量修改员工状态、角色、部门映射或个人额度。
- 开启 `ENABLE_SEED_ENDPOINT`、`ENABLE_CLEANUP_ENDPOINT`、`ENABLE_DEBUG_ENDPOINT`。

审批记录应保存在变更单或公司工单系统里，不要只保存在聊天记录。

## 13. 自动备份要求

生产必须有独立于应用进程的自动备份方案。最低要求：

- 每日备份 `/data/data.db`、`usage-queue.jsonl`、`usage-dead-letter.jsonl`。
- 文件名包含北京时间和 Git commit。
- 备份落到公司受控存储，不只保留在 Railway Volume 内。
- 至少保留 14 天。
- 每月至少抽样恢复 1 次。

自动备份只能记录环境变量名称、是否配置和最后更新时间；不得把明文 Secret 写入备份日志。

## 14. 恢复一致性

DB 和 queue 文件必须按同一时间点成套恢复：

- 只恢复旧 DB，不恢复 queue，可能导致已排队 usage 丢失或重复。
- 只恢复 queue，不恢复对应 DB，可能导致 usage 写入到不存在的用户、渠道或模型。
- 恢复后必须先小流量验证，再恢复正常开放。

如果恢复后发现 usage queue 无法入库，先保留原始 queue 文件，复制一份做人工修复，不要直接清空。

## 15. 备份访问控制

备份文件等同生产数据库，必须按敏感数据管理：

- 只有授权运维和甲方负责人可访问。
- 不得发送到个人网盘、个人聊天或非公司受控存储。
- 临时环境恢复后必须关闭真实飞书通知和外部自动同步。
- 临时环境验证完毕后销毁 DB 副本。
