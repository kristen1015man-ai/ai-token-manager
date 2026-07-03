---
name: sparkloom-release-check
description: Run a pre-production release readiness review for web, proxy, database, and desktop agent changes.
---

# Sparkloom Release Check

Use this skill before deployment.

## Checklist

1. Build and typecheck pass.
2. Secret scan has no real credentials.
3. Auth, quota, billing, and audit paths are tested.
4. Backup and rollback steps are documented.
5. Desktop artifacts are signed and checksummed when present.
6. Release evidence is recorded.

## Output

Return release blockers, required evidence, and go/no-go status.
