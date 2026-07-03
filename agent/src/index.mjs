import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  const env = Object.fromEntries(entries.entries());
  env.ANTHROPIC_AUTH_TOKEN = token;
  env.ANTHROPIC_API_KEY = token;
  env.CLAUDE_CONFIG_DIR = configDir;
  if (model) env.ANTHROPIC_MODEL = model;
  env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = "1";
  return env;
}

function permissionModeFor(value) {
  if (value === "plan") return "plan";
  if (value === "auto") return "auto";
  if (value === "safe_auto") return "acceptEdits";
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
  if (resolved.startsWith(userConfigDir()) || resolved.startsWith(path.resolve(__dirname, ".."))) {
    throw new Error("Project directory is not allowed. Please choose your actual code project folder.");
  }
  if (resolved === homedir() || resolved === path.dirname(homedir())) {
    throw new Error("不能选择用户主目录或其上级作为项目目录，请选一个具体的项目文件夹。");
  }
  if (process.platform === "win32" && !isAsciiPath(resolved)) {
    throw new Error(`Project directory contains non-ASCII characters and the local SDK runtime on Windows may not run there: ${resolved}. Move the project to an ASCII path such as C:\\SparkloomProjects\\app, then try again.`);
  }
  if (!(await isUsableDirectory(resolved))) {
    throw new Error(`Project directory does not exist or is not readable/writable: ${resolved}`);
  }
  return resolved;
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

  // 缓存命中（同网关+key+模型，5 分钟内已通过）则跳过，避免每个任务都阻塞首字
  const tokenHash = createHash("sha256").update(token).digest("hex").slice(0, 16);
  const cacheKey = `${baseUrl}|${tokenHash}|${String(model || "")}`;
  const now = Date.now();
  if (preflightCache && preflightCache.key === cacheKey && preflightCache.ok && now - preflightCache.at < 5 * 60 * 1000) {
    return;
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
    throw new Error(`Sparkloom 网关预检失败 (${res.status})${detail ? `：${detail}` : ""}`);
  }

  const ids = modelIdsFromPayload(payload);
  if (model && ids.length > 0 && !ids.includes(model)) {
    throw new Error(`当前模型不可用：${model}。请在 Studio 里切换到可用模型后再执行。`);
  }
  preflightCache = { key: cacheKey, ok: true, at: now };
  // 失败也短缓存 15 秒（避免网关 429 时被反复打爆）
  if (!preflightCache) preflightCache = null;
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
  if (/(^|\s)(rm|del|erase|truncate|rmdir)\s/.test(c) || /remove-item/.test(c)) {
    return /-rf|--force|\/[fqs]/.test(c)
      ? { risk: "danger", humanHint: "强制删除文件或文件夹（不可恢复）" }
      : { risk: "danger", humanHint: "删除文件或文件夹" };
  }
  if (/git\s+push|git\s+reset\s+--hard|git\s+push\s+--force|git\s+commit\s+--amend/.test(c)) {
    return { risk: "danger", humanHint: "Git 推送或强制改写历史（影响远程仓库）" };
  }
  if (/format\s+[a-z]:|mkfs/.test(c)) return { risk: "danger", humanHint: "格式化磁盘（极度危险）" };
  if (/taskkill|stop-process/.test(c)) return { risk: "danger", humanHint: "终止进程" };
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
  let entries = [];
  try {
    entries = await readdir(dest, { withFileTypes: true });
  } catch {
    // 目标目录不存在，直接复制
  }
  for (const entry of entries) {
    if (SNAPSHOT_EXCLUDE.has(entry.name)) continue;
    try {
      await rm(path.join(dest, entry.name), { recursive: true, force: true });
    } catch {
      // 忽略删除失败
    }
  }
  await copyDirSnapshot(src, dest);
}

function snapshotsDir() {
  return path.join(userConfigDir(), "snapshots");
}

async function createCheckpoint(cwd, label) {
  const id = `cp_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const dir = path.join(snapshotsDir(), id);
  await mkdir(snapshotsDir(), { recursive: true });
  await copyDirSnapshot(cwd, dir);
  await pruneSnapshots(20);
  return { id, dir, cwd, label: String(label || "").slice(0, 40), createdAt: Date.now() };
}

async function pruneSnapshots(maxKeep = 20) {
  let entries = [];
  try {
    entries = await readdir(snapshotsDir(), { withFileTypes: true });
  } catch {
    return;
  }
  const dirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("cp_")).map((e) => e.name).sort().reverse();
  for (const name of dirs.slice(maxKeep)) {
    try {
      await rm(path.join(snapshotsDir(), name), { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
}

async function rollbackCheckpoint(snap) {
  if (!snap || !snap.dir) throw new Error("快照不存在，无法回滚");
  await syncDirRollback(snap.dir, snap.cwd);
}

// ---- 审批管理器（每个任务一个，桥接 canUseTool 与前端审批卡片）----
function createApprovalManager(emit) {
  const pending = new Map();
  return {
    request(approval) {
      emit({ type: "approval_request", ...approval });
      return new Promise((resolve) => pending.set(approval.approvalId, resolve));
    },
    respond(approvalId, decision) {
      const resolve = pending.get(approvalId);
      if (resolve) {
        pending.delete(approvalId);
        resolve(decision === "allow" ? "allow" : "deny");
      }
    },
    rejectAll() {
      for (const resolve of pending.values()) resolve("deny");
      pending.clear();
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

async function runClaudeSdkTask({ prompt, model, cwd, maxTurns, permissionMode, originalMode, env, emit, signal, approvalManager }) {
  const sdk = await loadClaudeAgentSdk();
  if (!sdk?.query) {
    return { ok: false, unavailable: true, error: "Claude Agent SDK is not installed" };
  }

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
        // auto 模式：危险操作仍弹审批，其余自动放行
        if (originalMode === "auto") {
          if (risk !== "danger") return { behavior: "allow" };
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
    for await (const message of sdk.query({ prompt, options: queryOptions })) {
      const status = sdkStatusText(message);
      if (status) emit({ type: "status", text: redactSensitive(status) });

      const tool = sdkToolEvent(message);
      if (tool) {
        const isEditLike = /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(String(tool.name || ""));
        const inputStr = redactSensitive(JSON.stringify(tool.input || {}));
        emit({ type: "tool", toolUseId: tool.id || "", tool: redactSensitive(tool.name), input: isEditLike ? inputStr.slice(0, 20000) : inputStr.slice(0, 1200) });
      }

      // 工具执行结果（来自 user 消息的 tool_result），让前端工具卡片显示输出
      if (message?.type === "user" && Array.isArray(message.message?.content)) {
        for (const item of message.message.content) {
          if (item?.type === "tool_result") {
            const rc = typeof item.content === "string" ? item.content : JSON.stringify(item.content || "");
            emit({ type: "tool_result", toolUseId: item.tool_use_id || "", content: redactSensitive(rc).slice(0, 2000), isError: Boolean(item.is_error) });
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
  const prompt = cleanPrompt(body.prompt);
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
    if (type === "rollback") {
      const cpId = String(body.checkpointId || "");
      let handled = false;
      for (const t of tasks.values()) {
        const snap = t.checkpoints.get(cpId);
        if (snap) {
          handled = true;
          rollbackCheckpoint(snap)
            .then(() => wsSend(socket, { type: "rolled", checkpointId: cpId, requestId }))
            .catch((error) => wsSend(socket, { type: "error", requestId, error: redactSensitive(error instanceof Error ? error.message : "回滚失败") }));
          break;
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
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");
  if (!websocketOriginAllowed(req)) return rejectUpgrade(socket, 403, "Origin Not Allowed");
  if (String(req.headers.upgrade || "").toLowerCase() !== "websocket") return rejectUpgrade(socket, 400, "Bad Request");
  const key = String(req.headers["sec-websocket-key"] || "");
  if (!key) return rejectUpgrade(socket, 400, "Missing WebSocket Key");
  const token = url.searchParams.get("token") || "";
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
