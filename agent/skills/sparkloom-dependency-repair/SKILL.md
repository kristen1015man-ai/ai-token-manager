---
name: sparkloom-dependency-repair
description: Diagnose package manager, lockfile, and runtime dependency installation issues.
---

# Sparkloom Dependency Repair

Use this skill when install, build, or package manager commands fail.

## Workflow

1. Identify package manager and lockfile.
2. Check runtime versions.
3. Prefer frozen lockfile checks before modifying dependencies.
4. Explain whether the lockfile or manifest is out of sync.
5. Recommend the repair action and the safest execution mode. Use Ask when dependency files may change; use Plan when the user only wants diagnosis.

## Safety

Do not delete lockfiles or dependency directories without explicit confirmation.
