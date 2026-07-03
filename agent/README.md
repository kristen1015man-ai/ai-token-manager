# Sparkloom Agent

Sparkloom Agent is a local loopback service used by Sparkloom Studio.

It detects local developer tools, writes Sparkloom gateway configuration after
explicit local confirmation, installs reviewed Sparkloom skills, and runs tasks
for Studio through WebSocket + `@anthropic-ai/claude-agent-sdk`. It does not
store upstream provider keys and must never log raw `sk-emp-*` tokens.

## Endpoints

- `GET /health`
- `GET /environment`
- `GET /claude/status`
- `POST /claude/configure`
- `GET /ws`
- `GET /skills/status`
- `POST /skills/install`

The Agent binds to `127.0.0.1` only. Write endpoints require an
`x-sparkloom-local-confirm` header.

`GET /ws` is the only task execution transport. Browser clients connect with
the local pairing token in the query string and receive streaming status, tool,
delta, result, and done events. `/claude/run` is retired and returns `410`.

Studio exposes three execution modes:

- `default`: SDK default permissions, ask before restricted tool use.
- `plan`: plan mode, intended for analysis before changes.
- `auto`: automatic mode, still constrained by the SDK and local Agent
  boundaries.

## Windows

First extract the zip file. Do not run scripts from the compressed-folder
preview in Windows Explorer.

For non-technical users, double-click:

```text
Start Sparkloom.cmd
```

Sparkloom copies itself into the local user app folder, creates a desktop
shortcut, starts the local Agent, and opens:

```text
https://ai.seapllo.com/studio#sparkloomAgentToken=...
```

Later starts only need the `Sparkloom Studio` desktop shortcut.

Manual PowerShell usage is also supported:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-windows.ps1
```

The installer checks Node.js, npm, Python, Git, and the local Claude Agent SDK.
Missing tools are installed with WinGet when available. Agent dependencies are
installed inside the local Sparkloom app folder with:

```powershell
npm install --omit=dev --no-audit --no-fund
```

## macOS

Run Terminal from the extracted Agent directory:

```bash
chmod +x ./install-macos.sh
./install-macos.sh
```

The installer checks Homebrew, Node.js, npm, Python, Git, and the local Claude
Agent SDK. Agent dependencies are installed inside the extracted Agent folder
with:

```bash
npm install --omit=dev --no-audit --no-fund
```

## Manual Start

After dependencies are available:

```bash
./start-macos.sh
```

The start script opens Studio with the local pairing token. If you run
`node src/index.mjs` manually, Studio will not be paired and protected Agent
actions will return 401.

## Test Directories

By default, Agent writes gateway configuration to
`~/.sparkloom/claude-code.env` and installs bundled skills into
`~/.claude/skills/`.

Automated tests can override those locations without touching the real user
profile:

```bash
SPARKLOOM_CONFIG_HOME=/tmp/sparkloom-config \
SPARKLOOM_SKILLS_HOME=/tmp/sparkloom-skills \
node src/index.mjs
```
