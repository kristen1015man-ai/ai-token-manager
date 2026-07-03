#!/bin/bash
# PreToolUse (Bash pnpm dev*) hook：启动 dev 前杀掉常见占端口进程，避免 EADDRINUSE。
# 跨平台：Windows（Git Bash）调 kill-ports.ps1（避 bash 展开 $p/$_）；mac/linux 用 lsof。
if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$CLAUDE_CONFIG_DIR/hooks/kill-ports.ps1" 2>/dev/null
else
  for p in 3000 3001 4173 5173 8080; do
    pid=$(lsof -ti:"$p" 2>/dev/null)
    [ -n "$pid" ] && kill -9 $pid 2>/dev/null
  done
fi
exit 0
