---
name: sparkloom-nextjs-check
description: Check a Next.js project for route, runtime, data-fetching, and build issues.
---

# Sparkloom Next.js Check

Use this skill for Next.js projects.

## Checklist

1. Route handlers and pages do not conflict in the same segment.
2. Client components are not async.
3. Server-to-client props are serializable.
4. API routes use Node runtime unless Edge is required.
5. Auth and CSRF boundaries are consistent.
6. Build and typecheck commands are documented.

## Output

Return concrete risks and the next verification command.
