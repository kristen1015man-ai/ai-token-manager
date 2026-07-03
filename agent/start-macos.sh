#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIG_ROOT="${SPARKLOOM_CONFIG_HOME:-$HOME/.sparkloom}"
TOKEN_FILE="$CONFIG_ROOT/agent-token"
STUDIO_URL="${SPARKLOOM_STUDIO_URL:-https://ai.seapllo.com/studio}"

mkdir -p "$CONFIG_ROOT"
chmod 700 "$CONFIG_ROOT" || true
if [[ -f "$TOKEN_FILE" ]]; then
  TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
else
  TOKEN="$(LC_ALL=C tr -dc 'A-Za-z0-9_-' </dev/urandom | head -c 43)"
  printf '%s\n' "$TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE" || true
fi

ENCODED_TOKEN="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$TOKEN")"
if command -v open >/dev/null 2>&1; then
  open "$STUDIO_URL#sparkloomAgentToken=$ENCODED_TOKEN" >/dev/null 2>&1 || true
fi
node "$ROOT/src/index.mjs"
