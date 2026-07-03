#!/bin/bash
# Hook: PostToolUse (Bash) if git commit*
# commit 成功后自动 push

INPUT=$(cat)
# 提取退出码：兼容有 jq 和无 jq 的环境
if command -v jq &>/dev/null; then
  EXIT_CODE=$(echo "$INPUT" | jq -r '.tool_exit_code // .exit_code // "1"' 2>/dev/null)
else
  EXIT_CODE=$(echo "$INPUT" | grep -oP '"(?:tool_exit_code|exit_code)"\s*:\s*\K[0-9]+' | head -1)
fi

if [ "$EXIT_CODE" = "0" ]; then
  git push 2>&1 || true
fi

exit 0
