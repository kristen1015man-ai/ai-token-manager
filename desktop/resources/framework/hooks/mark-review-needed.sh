#!/bin/bash
# PostToolUse hook: 代码文件被编辑/创建后标记需要 review
# 兼容无 jq 环境

INPUT=$(cat)

if command -v jq &>/dev/null; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  FILE_PATH=$(echo "$INPUT" | grep -oP '"file_path"\s*:\s*"\K[^"]*' | head -1)
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  *.md|*.txt|*.json|*.yaml|*.yml|*.toml|*.lock|*.log|*.env|*.env.*|*.gitignore|*.prettierrc|*.eslintrc)
    ;;
  *)
    echo "needs_review" > "$CLAUDE_PROJECT_DIR/.claude/.needs-review"
    ;;
esac

exit 0
