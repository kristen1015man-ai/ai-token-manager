# Backup And Restore Runbook

This project stores production state in the Docker volume mounted at `/data/data.db`.
The database contains employee API keys, upstream channel keys, quota rules, usage
logs, billing data, and audit logs. Treat every backup as sensitive data.

## Backup Policy

- RPO: 15 minutes or better for production billing data.
- RTO: 30 minutes for single-node restore.
- Retention: hourly backups for 48 hours, daily backups for 30 days, monthly backups for 12 months.
- Storage: encrypted object storage or an encrypted backup host outside the app VM.
- Access: limited to production operators; never attach backups to chat or tickets.

## Create A Backup

Run on the Docker host:

```bash
mkdir -p backups
curl -fsS -X POST \
  -H "Authorization: Bearer ${INTERNAL_API_KEY}" \
  http://127.0.0.1:3000/api/internal/admin/flush-db
docker compose exec web sh -lc 'test -f /data/data.db && cp /data/data.db /data/data.db.backup'
docker cp "$(docker compose ps -q web):/data/data.db.backup" "backups/data-$(date +%Y%m%d-%H%M%S).db"
docker compose exec web rm -f /data/data.db.backup
```

Then encrypt and upload the file using your company backup tooling.

## Restore

1. Stop traffic at the reverse proxy or load balancer.
2. Stop the app services:

```bash
docker compose stop proxy web
```

3. Copy the selected backup into the app-data volume without starting the web server:

```bash
docker compose run --rm --no-deps \
  -v "$PWD/backups:/backup:ro" \
  --entrypoint sh web \
  -lc 'cp /backup/data-YYYYMMDD-HHMMSS.db /data/data.db'
docker compose up -d web proxy
```

4. Verify:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3001/health
```

5. Run an employee API key smoke test and confirm a new usage record appears.

## Restore Drill

Run a restore drill at least once per month in a non-production environment using
the latest backup. Record the backup timestamp, restore duration, validation
commands, and any data loss window.
