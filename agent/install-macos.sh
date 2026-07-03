#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIG_ROOT="${SPARKLOOM_CONFIG_HOME:-$HOME/.sparkloom}"
TOKEN_FILE="$CONFIG_ROOT/agent-token"
STUDIO_URL="${SPARKLOOM_STUDIO_URL:-https://ai.seapllo.com/studio}"

has_command() {
  command -v "$1" >/dev/null 2>&1
}

ensure_brew() {
  if has_command brew; then
    echo "[ok] Homebrew is already available"
    return
  fi
  echo "[install] Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_brew

if ! has_command node; then
  echo "[install] Node.js"
  brew install node
fi

if ! has_command python3; then
  echo "[install] Python"
  brew install python
fi

if ! has_command git; then
  echo "[install] Git"
  brew install git
fi

if ! has_command npm; then
  echo "npm is missing. Restart Terminal after Node.js installation, then rerun this script." >&2
  exit 1
fi

echo "[install] Sparkloom Agent SDK"
(cd "$ROOT" && npm install --omit=dev --no-audit --no-fund)
(cd "$ROOT" && node -e "import('@anthropic-ai/claude-agent-sdk').then((sdk)=>{ if (typeof sdk.query !== 'function') throw new Error('query export missing'); console.log('[ok] Claude Agent SDK ready') }).catch((error)=>{ console.error(error && error.message ? error.message : error); process.exit(1) })")

ensure_token() {
  mkdir -p "$CONFIG_ROOT"
  chmod 700 "$CONFIG_ROOT" || true
  if [[ -f "$TOKEN_FILE" ]]; then
    token="$(tr -d '\r\n' < "$TOKEN_FILE")"
    if [[ ${#token} -ge 32 ]]; then
      printf '%s' "$token"
      return
    fi
  fi
  token="$(LC_ALL=C tr -dc 'A-Za-z0-9_-' </dev/urandom | head -c 43)"
  printf '%s\n' "$token" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE" || true
  printf '%s' "$token"
}

urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
}

echo "[check] node: $(node --version)"
echo "[check] npm: $(npm --version)"
echo "[check] python3: $(python3 --version)"
echo "[check] git: $(git --version)"

TOKEN="$(ensure_token)"
ENCODED_TOKEN="$(urlencode "$TOKEN")"
if has_command open; then
  open "$STUDIO_URL#sparkloomAgentToken=$ENCODED_TOKEN" >/dev/null 2>&1 || true
fi

echo "[start] Sparkloom Agent on http://127.0.0.1:39271"
node "$ROOT/src/index.mjs"
