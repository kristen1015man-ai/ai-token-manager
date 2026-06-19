# Handoff Evidence - 2026-06-20

本文档记录 2026-06-20 交接前线上验收取证。所有命令输出均已避免记录密钥原文。

## 1. 本地基线

- Branch: `codex/production-readiness-snapshot`
- Runtime code commit: `a06dd1a fix: add internal backup verification`
- Tag: `handoff-2026-06-20`
- Workspace: clean after commit

本地已通过：

- `pnpm install --frozen-lockfile`
- `pnpm test`
- `pnpm --filter web lint`
- `pnpm --filter web build`
- `pnpm --filter proxy build`
- `pnpm audit --prod --registry=https://registry.npmjs.org`
- 临时 DB migration 烟测
- admin/internal route guard 扫描
- tracked secret 扫描
- `git diff --check`

## 2. Railway 生产部署

- Project: `heartfelt-education`
- Environment: `production`
- Service: `web`
- URL: `https://ai.seapllo.com`
- Volume: `web-volume-4jgN` mounted at `/data`
- Deployment ID: `e7ad52b3-4c34-448a-9419-84edd050a62b`
- Deployment status: `SUCCESS`
- Deployment time: `2026-06-20 01:28:27 +08:00`

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
- Deployment runtime logs show edge, web, and proxy started successfully after `e7ad52b3-4c34-448a-9419-84edd050a62b`
- Last 10 minutes 5xx HTTP logs after deployment: none returned by Railway CLI

## 6. Public Exposure Checks

- `GET https://ai.seapllo.com/api/internal/admin/reset-billing` -> 404
- `POST https://ai.seapllo.com/api/internal/admin/backup` -> 404
- Last 20 minutes 5xx HTTP logs: none returned by Railway CLI
- Last 20 minutes >=400 HTTP logs: only intentional `/api/internal/admin/reset-billing` and `/api/internal/admin/backup` 404 checks were observed

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

Conclusion: existing backups are present, but a full backup download and restore rehearsal is still not signed off.

Additional code remediation added after this evidence snapshot:

- Added `POST /api/internal/admin/backup`.
- The route requires `INTERNAL_API_KEY`.
- It flushes the sql.js DB to disk, copies `data.db`, `usage-queue.jsonl`, and `usage-dead-letter.jsonl` into `/data/backups/handoff-<timestamp>/`.
- It verifies the copied SQLite DB with `PRAGMA integrity_check`.
- It writes a `manifest.json` with file sizes, SHA-256 hashes, and core table counts.
- Public access must still return 404 through `railway/start.mjs` because the path is under `/api/internal/*`.

This closes the code-level backup-verification gap, but the production drill still needs execution and sign-off.

Local route smoke evidence:

- Started `web` in production mode on a temporary local DB copy.
- Confirmed missing `ENCRYPTION_KEY` triggers production fail-fast before the smoke test.
- Re-ran with a local test `ENCRYPTION_KEY` and `INTERNAL_API_KEY`.
- `POST /api/internal/admin/backup` returned `success=true`.
- `verification.integrity` returned `ok`.
- `manifest.sha256` and `files.dataDb.sha256` were generated.
- Temporary local DB and backup files were deleted after the smoke test.

## 8. Remaining Sign-Off Evidence

以下仍需业务侧或接收方配合完成，不能由本地代码单独证明：

- 管理员飞书登录 UAT
- 普通员工飞书登录 UAT
- 员工新建一次性明文 API Key 并保存客户端配置
- 使用真实员工 `sk-emp-...` 调用 `/v1/models`
- 使用真实员工 `sk-emp-...` 小额调用 `/v1/chat/completions` 或 `/anthropic`
- 验证 usage 入库、费用、额度扣减、阈值通知
- 余额同步和余额低提醒真实群/个人通知
- 排行榜测试发送
- 生产备份下载、恢复演练和回滚演练
