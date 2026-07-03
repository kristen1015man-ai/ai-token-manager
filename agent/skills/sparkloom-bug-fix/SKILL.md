---
name: sparkloom-bug-fix
description: Diagnose and fix a concrete bug with minimal, verifiable changes.
---

# Sparkloom Bug Fix

Use this skill when the user reports a specific broken behavior.

## Workflow

1. Reproduce or identify the failing path.
2. Find the smallest safe change.
3. Preserve unrelated edits.
4. Add or update focused tests when risk justifies it.
5. Verify the fix with the narrowest reliable command.

## Safety

Do not run destructive git commands. Do not expose secrets in logs or summaries.
