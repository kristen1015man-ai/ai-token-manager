---
name: sparkloom-project-doctor
description: Check whether a local project can start cleanly and identify missing runtime dependencies.
---

# Sparkloom Project Doctor

Use this skill when a user asks why a project cannot start, build, or run locally.

## Workflow

1. Inspect package manifests, lockfiles, framework config, and runtime version files.
2. Check whether Node.js, Python, Git, and package managers are available.
3. Prefer read-only commands first: version checks, `git status`, package script listing, and dependency tree checks.
4. When an install or repair action is needed, describe the safest Agent execution mode: Ask for normal work, Plan for analysis-only, Auto only for trusted low-risk tasks.
5. Do not read `.env`, cloud credentials, SSH keys, browser profiles, or password manager files.

## Output

Return a concise diagnosis, required fixes, and the safest next action.
