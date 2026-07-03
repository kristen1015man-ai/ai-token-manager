# PreToolUse (Bash pnpm dev*) hook：启动 dev 前杀掉常见占端口进程，避免 EADDRINUSE。
# 抽成独立 .ps1 由 settings.json 用 powershell -File 调用，避开 Git Bash 对内联命令里
# $p / $_ 的变量展开（之前内联 command 经 bash 执行会被展开成空，端口清理失效）。
foreach ($p in @(3000, 3001, 4173, 5173, 8080)) {
  Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
