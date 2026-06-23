# 备份、恢复和重置

最后更新：2026-06-18

本文档用于保护生产数据。Sparkloom 当前使用 SQLite 文件，备份恢复必须严格执行。

## 1. 需要备份的文件

生产核心文件：

- `/data/data.db`

计费队列文件：

- Docker Compose: `/usage/usage-queue.jsonl`
- Docker Compose: `/usage/usage-dead-letter.jsonl`
- Railway single-image: use configured `USAGE_QUEUE_FILE` / `USAGE_DEAD_LETTER_FILE`, usually under `/data`.

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

生产 Railway 推荐启用对象存储备份上传，避免 Railway CLI 下载大文件超时。配置以下变量后，同一个内部备份接口会把完整备份目录上传到 S3-compatible 存储，例如 Cloudflare R2：

```env
BACKUP_OBJECT_STORAGE_ENABLED=true
BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUP_S3_REGION=auto
BACKUP_S3_BUCKET=sparkloom-prod-backups
BACKUP_S3_ACCESS_KEY_ID=<access-key-id>
BACKUP_S3_SECRET_ACCESS_KEY=<secret-access-key>
BACKUP_S3_PREFIX=production
```

上传成功时响应会包含 `objectStorage.backupPrefix`，例如 `production/handoff-2026-06-23T...`。该前缀下必须有：

- `data.db`
- `manifest.json`
- `usage-queue.jsonl`
- `usage-dead-letter.jsonl`

正式灾备签收应从对象存储下载这个完整前缀到公司受控目录，再执行 `node scripts/verify-sqlite-backup.mjs <backup-dir>`。不要把 R2/S3 的 Access Key 或 Secret Access Key 写入交接文档。

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

下载到公司受控存储后，必须在本地或临时环境执行只读校验：

```bash
node scripts/verify-sqlite-backup.mjs /path/to/data.db
node scripts/verify-sqlite-backup.mjs /path/to/backup-dir
```

输出必须满足：

- `ok=true`
- `integrity=ok`
- `missingTables=[]`
- `users`、`channels`、`model_prices`、`usage_logs` 等核心表计数符合预期
- 目录级校验时 `inputType=backup-directory`
- 目录级校验时 `backupSet.dataDb`、`backupSet.manifest`、`backupSet.usageQueue`、`backupSet.usageDeadLetter` 均 present
- 目录级校验时 `manifestMatches=true`，确认 manifest 中记录的文件哈希和实际文件一致

该脚本只读打开 SQLite 文件，不会修改备份内容，也不会输出密钥明文。正式灾备签收应优先校验完整备份目录；单独 `data.db` 只能证明 DB 文件可读，不能证明 usage queue/dead-letter 与 DB 是同一恢复点。

`usage-queue.jsonl` 和 `usage-dead-letter.jsonl` 必须作为文件存在。如果备份时没有待重试或死信记录，系统会生成 0 字节空文件，并在 `manifest.json` 中记录空文件哈希。接收方不要因为文件为空而删除它们，目录级校验会用 manifest 同时核对这两个文件和 `data.db`。

注意：2026-06-20 交接演练中，Railway CLI 可以列出备份目录并下载 `manifest.json`，但下载约 13.5 MB 的 `data.db` 多次因 `Timeout` 失败，目录下载并降低 concurrency 也未解决。因此正式灾备不能只依赖本机 Railway CLI 大文件下载；接收方应使用 Railway 可用的文件下载通道、对象存储备份任务，或公司认可的运维通道，把完整备份搬运到受控存储后再执行 `verify-sqlite-backup.mjs` 和恢复演练。

## 5. 恢复步骤

恢复必须走维护窗口，目标是让 DB 和 usage queue/dead-letter 按同一时间点成套恢复。

### 5.1 恢复前停写

1. 在飞书或运维群公告维护窗口，暂停员工客户端调用。
2. Railway 将生产服务临时停写或停止服务；如果使用 Railway CLI，先确认当前 project/environment：

```powershell
railway status
railway service
```

3. 恢复前先生成当前生产卷的二次备份，不要直接覆盖：

```powershell
railway run node -e "fetch('http://127.0.0.1:3000/api/internal/admin/backup',{method:'POST',headers:{Authorization:'Bearer '+process.env.INTERNAL_API_KEY}}).then(r=>r.text()).then(console.log)"
```

如果服务已经无法启动，则直接通过 Railway Volume 文件功能复制当前 `/data/data.db`、`usage-queue.jsonl`、`usage-dead-letter.jsonl` 到带时间戳的保全目录。

### 5.2 校验待恢复备份

在公司受控存储下载完整备份目录后，先本地只读校验：

```powershell
node scripts/verify-sqlite-backup.mjs <downloaded-backup-dir>
```

必须满足：

- `ok=true`
- `inputType=backup-directory`
- `integrity=ok`
- `missingTables=[]`
- `backupSet.dataDb.present=true`
- `backupSet.manifest.present=true`
- `backupSet.usageQueue.present=true`
- `backupSet.usageDeadLetter.present=true`
- `manifestMatches=true`

如果只有单个 `data.db` 文件，最多只能证明 DB 文件可读，不能作为正式灾备恢复签收。

### 5.3 上传恢复文件

Railway Volume 上传命令随 CLI 版本变化，执行前先查看本机可用语法：

```powershell
railway volume files --help
railway volume files upload --help
```

恢复时需要把同一备份目录中的文件上传到生产挂载目录：

```powershell
railway volume files upload <downloaded-backup-dir>\data.db /data/data.db
railway volume files upload <downloaded-backup-dir>\usage-queue.jsonl /data/usage-queue.jsonl
railway volume files upload <downloaded-backup-dir>\usage-dead-letter.jsonl /data/usage-dead-letter.jsonl
```

上传后列目录确认大小和文件存在：

```powershell
railway volume files list /data --json
```

### 5.4 重启和验证

1. 重启生产服务。
2. 调用健康检查：

```powershell
curl https://ai.seapllo.com/health
curl https://ai.seapllo.com/api/health
```

3. 使用内部详细健康检查确认 DB 可读写、密钥解密正常、usage queue 可写：

```powershell
curl -H "Authorization: Bearer $env:INTERNAL_API_KEY" https://ai.seapllo.com/api/health
```

4. 登录后台核对：
   - 用户数。
   - 渠道数。
   - 模型价格数。
   - 本月 usage。
   - 余额。
   - 通知接收人配置。
5. 用测试员工 Key 小流量验证 `/v1/models` 和一次 chat 调用。正式签收时还要执行 `docs/HANDOFF-BUSINESS-UAT-SIGNOFF.template.json` 的业务 UAT 签收。

### 5.5 临时环境恢复演练

临时环境恢复时必须关闭真实通知和自动同步，避免恢复演练误发飞书消息或改写生产数据。最低要求：

- 使用独立 Railway 环境或本地临时环境。
- 不使用生产 `FEISHU_APP_SECRET` 发送真实通知。
- 不开启自动余额同步、排行榜发送和飞书通讯录写操作。
- 验证完成后销毁临时 DB 副本。

## 6. 计费重置

计费重置会清空或重置用量数据，必须先备份。

内部接口：

- `POST /api/internal/admin/reset-billing`

额外保护：

- Web 侧必须临时设置 `ENABLE_INTERNAL_BILLING_RESET=true`。
- Proxy 侧必须临时设置 `ENABLE_PROXY_USAGE_QUEUE_CLEAR=true`，否则 Web 不会清空 Proxy 内存 usage queue。
- 请求必须带 `x-sparkloom-maintenance-confirm: reset-billing-usage`。
- 执行完成后必须立刻把两个维护开关恢复为 `false` 或删除。

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

- 每日备份 `data.db`、`usage-queue.jsonl`、`usage-dead-letter.jsonl`。Docker Compose 中 queue/dead-letter 位于共享 `/usage` 卷；Railway 单镜像按 `USAGE_QUEUE_FILE` / `USAGE_DEAD_LETTER_FILE` 配置。
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
