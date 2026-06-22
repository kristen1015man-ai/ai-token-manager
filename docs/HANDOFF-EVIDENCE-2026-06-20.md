# Handoff Evidence - 2026-06-20

## 2026-06-22 Production Update

This section records the latest production alignment after the final handoff hardening pass.

- Branch: `codex/production-readiness-snapshot`
- Commit deployed: `9eedcbde94ff37f46971d9234aa5123b492b681b`
- Railway deployment ID: `51207b03-2822-4b18-b557-3576e9d094fd`
- Railway status: `SUCCESS`
- Image digest: `sha256:be019d71c95a63b2f8b4f5cafd1dafe15f256d1ae4e2fe3923975fb9e2e7f77a`
- Production URL: `https://ai.seapllo.com`
- Local gates before deploy: `pnpm check` passed; `git diff --check` passed.

Production sensitive-field migration:

- Command path: `POST /api/internal/admin/migrate/encrypt`
- Public unauthenticated access remains blocked by the Railway edge with 404.
- Execution used `INTERNAL_API_KEY` plus `x-sparkloom-maintenance-confirm: encrypt-sensitive-fields`.
- Migration time: `2026-06-22T08:11:52.366Z` / `2026-06-22 16:11:52 +08:00`
- Result: channels total `5`, encrypted `0`, skipped `5`; users total `155`, encrypted `4`, hashed `1`, skipped `150`.
- Follow-up hardening: the temporary Railway edge allowlist used for this one migration was removed after success; `/api/internal/*` is again blocked at the Railway edge.
- Hardening deployment: `307ed344-31ab-44eb-9709-0c099899bc26`, commit `c924c41`, image digest `sha256:9efec89cb0aab4907194913010a3e99ec66a224c266ff851d0b1902c572d5730`.
- Post-hardening verification: `POST /api/internal/admin/migrate/encrypt` returned 404 even when called with `INTERNAL_API_KEY` and the maintenance confirmation header through the public Railway edge.

Post-migration health:

- Detailed `GET /api/health`: 200, `status=ok`.
- `secretDecryption`: `ok=true`, checked `168`, failures `[]`.
- `secretStorage`: `ok=true`, checked `168`, plaintext `[]`.
- DB readable/writable: true.
- DB file, usage queue, and dead-letter directories writable: `/data`.
- User counts: active `154`, disabled `1`.
- Detailed `GET /health`: 200, `status=ok`; proxy usage queue pending records `0`.
- Detailed `GET /health` after edge hardening: 200, `status=ok`; proxy usage queue pending records `0`.

Production smoke:

- Command: `pnpm smoke:production`
- Time: `2026-06-22T08:12:31.924Z` / `2026-06-22 16:12:31 +08:00`
- Result: `ok=true`, `complete=false`.
- Re-run after edge hardening: `2026-06-22T08:28:27.119Z` / `2026-06-22 16:28:27 +08:00`, `ok=true`, `complete=false`.
- Public health passed: `/health` 200 and `/api/health` 200.
- Public blocking passed:
  - `POST /api/internal/admin/backup`: 404
  - `POST /api/internal/admin/migrate/encrypt`: 404
  - `GET /api/internal/admin/reset-billing`: 404
  - `GET /api/auth/dev-login`: 404
  - `POST /api/setup/seed`: 403
- Skipped checks remain: internal detailed health inside public smoke, employee `/v1/models`, billable chat, and billable stream chat, because no employee `sk-emp-...` test key was provided to the local shell.

Remaining formal sign-off evidence is unchanged: business UAT with a real employee key, external backup/restore drill, and asset ownership handoff JSONs are still required before `pnpm handoff:final` can pass.

本文档记录 2026-06-20 交接前线上验收取证。所有命令输出均已避免记录密钥原文。

## 1. 本地基线

- Branch: `codex/production-readiness-snapshot`
- Handoff repository commit: 以 `pnpm handoff:status` 或 `git rev-list -n 1 handoff-2026-06-20` 输出为准
- Runtime deployment commit: `ac5c578 fix: limit employee api key creation abuse`
- Tag: `handoff-2026-06-20`
- Workspace: clean after commit

Current production snapshot, updated 2026-06-21 23:12 +08:00:

- Runtime commit: `ac5c578113b7428deba99a162589c20a38e4fb78`
- Railway deployment ID: `09d41ffa-39e8-4955-988a-bf3c70df266a`
- Railway status: `Online`
- URL: `https://ai.seapllo.com`
- Local pre-deploy checks passed: `pnpm test`, `pnpm --filter web build`, `pnpm --filter proxy build`
- Production public smoke passed: `pnpm smoke:production`; output now reports `complete=false` when employee/internal checks are intentionally skipped.
- Production internal smoke with Railway environment passed: detailed health returned DB readable/writable and secret decryption sample `ok=true`, checked `28`, failures `[]`.
- Employee billable smoke remains pending because no employee `sk-emp-*` test key was provided to the local shell.

说明：`handoff-2026-06-20` 是 annotated tag，核对提交时必须使用 `git rev-list -n 1 handoff-2026-06-20`，不要用 `git rev-parse handoff-2026-06-20` 直接当作提交 SHA。当前线上稳定 deployment 为 `09d41ffa-39e8-4955-988a-bf3c70df266a`，运行代码来自 `ac5c578 fix: limit employee api key creation abuse`。

本地已通过：

- `pnpm install --frozen-lockfile`
- `pnpm test`
- `pnpm handoff:status`
- `pnpm handoff:uat`
- `pnpm handoff:readiness`
- `pnpm --filter web lint`
- `pnpm --filter web build`
- `pnpm --filter proxy build`
- `pnpm audit --prod --registry=https://registry.npmjs.org`
- 临时 DB migration 烟测
- admin/internal route guard 扫描
- tracked secret 扫描
- directory-level admin/setup/internal route auth scan
- tracked env concrete secret scan
- backup verification helper smoke test: `scripts/verify-sqlite-backup.mjs`
- production public smoke helper: `scripts/production-smoke.mjs`
- handoff status helper: `scripts/handoff-status.mjs`
- handoff UAT evidence helper: `scripts/handoff-uat-evidence.mjs`
- handoff readiness report helper: `scripts/handoff-readiness-report.mjs`
- formal UAT/sign-off checklist: `docs/HANDOFF-UAT-SIGNOFF.md`
- structured business UAT handoff template: `docs/HANDOFF-BUSINESS-UAT-SIGNOFF.template.json`
- structured backup/restore handoff template: `docs/HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json`
- structured asset handoff template: `docs/HANDOFF-ASSET-SIGNOFF.template.json`
- `git diff --check`

## 2. Railway 生产部署

- Project: `heartfelt-education`
- Environment: `production`
- Service: `web`
- URL: `https://ai.seapllo.com`
- Volume: `web-volume-4jgN` mounted at `/data`
- Deployment ID: `09d41ffa-39e8-4955-988a-bf3c70df266a`
- Deployment status: `SUCCESS`
- Deployment time: `2026-06-21 16:35 +08:00`

部署前已补齐非敏感生产变量：

- `NODE_ENV=production`
- `UPSTREAM_ALLOWED_HOSTS=api.deepseek.com,api.siliconflow.cn,open.bigmodel.cn,api.openai.com,api.anthropic.com`

生产变量预检结果：

- required env missing: `[]`
- dangerous flags enabled: `[]`
- `JWT_SECRET` length check: ok
- `INTERNAL_API_KEY` length check: ok
- `ENCRYPTION_KEY` length check: ok
- `FEISHU_APP_SECRET` length check: ok
- `FEISHU_APP_ID` format: ok
- `NEXT_PUBLIC_FEISHU_APP_ID` matches server app id: ok
- redirect URLs use HTTPS and match: ok
- `PUBLIC_PROXY_BASE_URL` uses HTTPS: ok
- CORS wildcard: false
- upstream allowlist count: 5

## 3. Build Evidence

Railway build succeeded:

- Docker build used `node:22-alpine`
- `pnpm install --frozen-lockfile` passed
- `cd web && pnpm next build` passed
- Next build route list includes `/api/internal/admin/backup`
- Build includes default-disabled startup backup drill hook
- `pnpm --filter proxy build` passed
- image pushed successfully

## 4. Runtime Evidence

Deployment logs show:

- edge listening on port `8080`
- web upstream `http://127.0.0.1:3000`
- proxy upstream `http://127.0.0.1:3001`
- Hono proxy started on port `3001`
- Next.js ready on `127.0.0.1:3000`
- `/data` volume mounted
- `ENCRYPTION_KEY` configured
- auto-sync schedules use Beijing time
- `/health` returned 200 after startup

## 5. Online Health

Public health checks:

- `GET https://ai.seapllo.com/health` -> 200, `status=ok`, `service=ai-token-proxy`
- `GET https://ai.seapllo.com/api/health` -> 200, `status=ok`, `service=sparkloom-web`

Detailed health checks with internal Bearer:

- Proxy `/health`: 200, `status=ok`
- Web detail inside proxy health: 200, `status=ok`
- Web `/api/health`: 200, `status=ok`
- DB readable: true
- DB writable: true
- DB file directory writable: `/data`
- usage queue writable: `/data`
- usage dead-letter writable: `/data`
- secret decryption sample: ok, checked 15, failures 0
- proxy usage queue pending records: 0
- proxy queue file: `/data/usage-queue.jsonl`
- proxy dead-letter file: `/data/usage-dead-letter.jsonl`
- active users: 152
- disabled users: 1
- Public `POST https://ai.seapllo.com/api/internal/admin/backup` -> 404
- Deployment runtime logs show edge, web, and proxy started successfully after `11e4cccf-88fc-483e-90e2-ded4f5919813`
- Last 10 minutes 5xx HTTP logs after deployment: none returned by Railway CLI

## 6. Public Exposure Checks

- `GET https://ai.seapllo.com/api/internal/admin/reset-billing` -> 404
- `POST https://ai.seapllo.com/api/internal/admin/backup` -> 404
- Last 20 minutes 5xx HTTP logs: none returned by Railway CLI
- Last 20 minutes >=400 HTTP logs: only intentional `/api/internal/admin/reset-billing` and `/api/internal/admin/backup` 404 checks were observed

Production smoke helper result:

- Command: `node scripts/production-smoke.mjs --base https://ai.seapllo.com`
- Time: `2026-06-21 16:35 +08:00`
- Result: `ok=true`
- Confirmed public health:
  - `/health`: 200, `service=ai-token-proxy`
  - `/api/health`: 200, `service=sparkloom-web`
- Confirmed public blocking:
  - `POST /api/internal/admin/backup`: 404
  - `GET /api/internal/admin/reset-billing`: 404
  - `GET /api/auth/dev-login`: 404
  - `POST /api/setup/seed`: 403
- Internal detailed health was skipped in this public run because no `INTERNAL_API_KEY` was provided to the local shell.
- Employee `/v1/models` and billable chat were skipped because no employee `sk-emp-...` key was provided to the local shell.

Production smoke with Railway environment:

- Command: `railway run node scripts/production-smoke.mjs --base https://ai.seapllo.com`
- Time: `2026-06-21 16:35:16 +08:00`
- Result: `ok=true`
- Internal detailed health: 200, DB readable true, DB writable true, secret decryption sample ok, checked 28, failures 0.
- User counts in detailed health: active 152, disabled 1.
- Employee `/v1/models` and billable chat were intentionally skipped because no employee `sk-emp-...` key was provided.

## 7. Backup / Restore Evidence

Railway volume check:

- Attached production volume: `web-volume-4jgN`
- Mount path: `/data`
- Storage used during check: about `117 MB / 500 MB`
- Root files observed: `data.db`, `usage-queue.jsonl`, `backups/`
- Existing backup files observed under `/backups`, all about `13.5 MB`:
  - `data-before-billing-reset-2026-06-18T06-54-01-287Z.db`
  - `data-before-billing-reset-2026-06-18T06-54-19-791Z.db`
  - `data-before-billing-reset-2026-06-18T06-59-48-646Z.db`
  - `data-before-reset-mock-20260617T090549Z.db`

Attempted non-destructive backup drill:

- `railway ssh -- ls -lah /data` did not return in time and was terminated.
- `railway volume files download /data.db` also did not return in time and was terminated.
- Local temporary directory used for the attempted download was deleted.
- No production DB copy was intentionally retained locally.

Conclusion at this point: existing backups are present, but a full backup download and restore rehearsal was not signed off yet.

Additional code remediation added after this evidence snapshot:

- Added `POST /api/internal/admin/backup`.
- The route requires `INTERNAL_API_KEY`.
- It flushes the sql.js DB to disk, copies `data.db`, `usage-queue.jsonl`, and `usage-dead-letter.jsonl` into `/data/backups/handoff-<timestamp>/`.
- It verifies the copied SQLite DB with `PRAGMA integrity_check`.
- It writes a `manifest.json` with file sizes, SHA-256 hashes, and core table counts.
- Public access must still return 404 through `railway/start.mjs` because the path is under `/api/internal/*`.

This closes the code-level backup-verification gap.

Local route smoke evidence:

- Started `web` in production mode on a temporary local DB copy.
- Confirmed missing `ENCRYPTION_KEY` triggers production fail-fast before the smoke test.
- Re-ran with a local test `ENCRYPTION_KEY` and `INTERNAL_API_KEY`.
- `POST /api/internal/admin/backup` returned `success=true`.
- `verification.integrity` returned `ok`.
- `manifest.sha256` and `files.dataDb.sha256` were generated.
- Temporary local DB and backup files were deleted after the smoke test.

Production startup backup drill evidence:

- Drill deployment: `28fc0b94-c076-4eb3-9092-2a58340aebd6`
- Drill time: `2026-06-20 10:48:29 +08:00`
- Temporary env used: `RUN_BACKUP_DRILL_ON_START=true`, `BACKUP_DRILL_RUN_ID=handoff-20260620-1038`
- Log marker: `[BackupDrill] completed`
- `backupDir`: `/data/backups/handoff-2026-06-20T02-50-12-179Z`
- `manifestSha256`: `988486aafc477cb22b0d0fb905064b191ec6f8eb9500056dafecf5dddb3b56cd`
- `dataDbSha256`: `d17f8c4102515f4fc08269b7fd347b93e011f386a1d16fb3d8cbe68e20c3de2a`
- `dataDbSize`: `13545472`
- `usageQueueCopied`: true
- `usageDeadLetterCopied`: false, because no dead-letter file existed at drill time
- `verification.integrity`: `ok`
- Core counts: `tables=13`, `users=153`, `userApiKeys=8`, `channels=5`, `modelPrices=30`, `usageLogs=104`, `quotaReservations=0`, `alertLogs=3`
- Volume listing confirmed:
  - `/backups/handoff-2026-06-20T02-50-12-179Z/data.db`, size `13545472`
  - `/backups/handoff-2026-06-20T02-50-12-179Z/manifest.json`, size `984`
  - `/backups/handoff-2026-06-20T02-50-12-179Z/usage-queue.jsonl`, size `0`
- `manifest.json` was downloaded, parsed for the sanitized summary above, and then deleted locally.

Drill cleanup:

- `RUN_BACKUP_DRILL_ON_START` deleted.
- `BACKUP_DRILL_RUN_ID` deleted.
- Stable deployment after cleanup: `d96ff72c-f4a1-45ec-ae18-bf4168faf442`
- Runtime env check after cleanup: `[null,null]` for `[RUN_BACKUP_DRILL_ON_START,BACKUP_DRILL_RUN_ID]`
- Stable deployment logs contain no new `[BackupDrill] completed` entry.
- Stable deployment health: `GET /api/health` with internal Bearer returned 200, `status=ok`.
- Last 15 minutes 5xx HTTP logs after stable deployment: none returned by Railway CLI.

Conclusion after drill: production in-volume backup generation and SQLite integrity verification are signed off. External backup download to company-controlled storage and full temporary-environment restore rehearsal are still not signed off.

Additional external-download retry:

- Time: `2026-06-20 18:01:02 +08:00`
- Production volume ID used: `dc6af80e-f35b-4892-b19e-cc13bd0ece5e` (`web-volume-4jgN`, `/data`).
- `railway volume files --volume dc6af80e-f35b-4892-b19e-cc13bd0ece5e list /backups/handoff-2026-06-20T02-50-12-179Z --json` succeeded and listed `data.db`, `manifest.json`, `usage-queue.jsonl`.
- `manifest.json` downloaded successfully and matched the previous drill metadata: DB size `13545472`, DB SHA-256 `d17f8c4102515f4fc08269b7fd347b93e011f386a1d16fb3d8cbe68e20c3de2a`, `verification.integrity=ok`.
- `railway volume files ... download .../data.db ...` failed with Railway CLI `Timeout` after leaving a partial local file of `2097152` bytes.
- Two `railway ssh --service web -- ...` attempts for listing/checksum did not return after waiting and were terminated locally.
- The temporary local directory containing the partial DB and manifest was deleted. No production DB copy is retained locally.
- A directory download retry with `railway volume files ... download /backups/handoff-2026-06-20T02-50-12-179Z ... --concurrency 1 --json` also failed on `data.db` with Railway CLI `Timeout`. The temporary local directory was deleted.

Conclusion after retry: Railway volume listing and manifest download are available, but full DB download through the current local Railway CLI/SSH channel is still blocked. Formal disaster-recovery sign-off still requires a reliable platform download path, object storage backup job, or another approved operations channel to move the full backup into company-controlled storage and restore it in a temporary environment.

## 8. Remaining Sign-Off Evidence

以下仍需业务侧或接收方配合完成，不能由本地代码单独证明：

- 管理员飞书登录 UAT
- 普通员工飞书登录 UAT
- 员工新建一次性明文 API Key 并保存客户端配置
- 使用真实员工 `sk-emp-...` 调用 `/v1/models`
- 使用真实员工 `sk-emp-...` 小额调用 `/v1/chat/completions` 或 `/anthropic`
- 使用 `scripts/production-smoke.mjs` 结合真实员工 Key 归档 `/v1/models` 和小额计费 smoke 输出
- 验证 usage 入库、费用、额度扣减、阈值通知
- 余额同步和余额低提醒真实群/个人通知
- 排行榜测试发送
- 生产备份下载到公司受控存储、临时环境恢复演练和回滚演练
- 结构化业务 UAT 签收：复制 `docs/HANDOFF-BUSINESS-UAT-SIGNOFF.template.json` 到受控目录，填写自动 smoke、usage 入库、费用核对和脱敏审查，并作为 `--uat-evidence` 输入 `pnpm handoff:readiness` 或 `pnpm handoff:final`
- 结构化备份恢复签收：复制 `docs/HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json` 到受控目录，填写 SQLite 校验、外部存储、恢复演练、回滚演练，并作为 `--backup-verification` 输入 `pnpm handoff:readiness` 或 `pnpm handoff:final`
- 结构化资产交割签收：复制 `docs/HANDOFF-ASSET-SIGNOFF.template.json` 到受控目录，填写代码仓库、Railway、DNS、飞书应用、供应商账号、通知群、生产密钥库、备份存储八项资产，并作为 `--asset-signoff` 输入 `pnpm handoff:readiness`

## 9. Additional Handoff Gate Tightening

2026-06-20 追加：

- `pnpm handoff:readiness` 不再只接受“存在一个资产交割文件”作为通过条件。
- `business-uat` 现在要求 `docs/HANDOFF-BUSINESS-UAT-SIGNOFF.template.json` 结构：自动 smoke、usage 入库核对、费用核对和脱敏审查都完成；单独 `pnpm handoff:uat` 输出不再足够。
- `asset-handoff` 现在要求八项资产都 `complete=true`，且每项都有非空 `owner`、`permission`、`evidenceRef`。
- `backup-restore` 现在要求 `docs/HANDOFF-BACKUP-RESTORE-SIGNOFF.template.json` 结构：SQLite 校验、外部受控存储、临时环境恢复演练、回滚演练都完成；单独 DB 校验 JSON 不再足够。
- `pnpm handoff:final` 用于正式签收强制门禁，缺任一证据时退出非 0。
- 本地交接工作区中的 `.env`、`backups/`、`web/data.db`、`web/.next/standalone/web/data.db` 已移动到仓库外隔离目录，防止打包交接目录时泄露密钥或历史员工 Key 材料。
- `pnpm test` 现在会检查上述本地敏感物是否回到交接工作区。
- `reset-billing` 和 Proxy usage queue 清理已增加维护开关和确认头，避免单个 `INTERNAL_API_KEY` 泄露后直接执行破坏性操作。
- 签收 JSON 格式错误或路径错误会在 readiness report 的 `readError` 中显示，脚本不会直接崩溃。
- 实际签收文件建议命名为 `handoff-asset-signoff.json` 并放入公司受控存储；仓库 `.gitignore` 已禁止提交该类签收证据文件。
