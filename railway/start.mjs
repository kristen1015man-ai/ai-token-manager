import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const publicPort = Number(process.env.PORT || 8080);
const webPort = Number(process.env.WEB_PORT_INTERNAL || 3000);
const proxyPort = Number(process.env.PROXY_PORT || 3001);
const parsedMaxRequestBodyBytes = Number(process.env.MAX_REQUEST_BODY_BYTES);
const maxRequestBodyBytes = Number.isFinite(parsedMaxRequestBodyBytes) && parsedMaxRequestBodyBytes > 0
  ? Math.floor(parsedMaxRequestBodyBytes)
  : 2 * 1024 * 1024;
const children = new Set();
let shuttingDown = false;
let serverListening = false;

const DANGEROUS_DEFAULTS = new Set([
  "dev-secret-change-in-production",
  "change-me-to-a-random-string",
  "your-random-secret-at-least-32-characters-long",
  "xxx",
  "your_app_secret",
]);

const PRODUCTION_DISABLED_FLAGS = [
  "ALLOW_EPHEMERAL_DATA",
  "ALLOW_INSECURE_DEV_AUTH",
  "ALLOW_INSECURE_UPSTREAMS",
  "ALLOW_PRIVATE_UPSTREAMS",
  "ALLOW_PLAINTEXT_SECRETS_FOR_DEV",
  "ENABLE_DEV_LOGIN",
  "ENABLE_DEBUG_ENDPOINT",
  "ENABLE_SEED_ENDPOINT",
  "ENABLE_CLEANUP_ENDPOINT",
];
const BAD_FEISHU_APP_PREFIX = "cli_" + "cli_";

function failProductionConfig(message) {
  console.error(`[railway] ${message}`);
  process.exit(1);
}

function envValue(name) {
  return (process.env[name] || "").trim();
}

function isTruthyEnv(name) {
  return envValue(name).toLowerCase() === "true";
}

function isProductionRuntime() {
  return envValue("NODE_ENV") === "production" || envValue("RAILWAY_ENVIRONMENT_NAME") === "production";
}

function isPlaceholderValue(value) {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    DANGEROUS_DEFAULTS.has(normalized) ||
    normalized.includes("change-me") ||
    normalized.includes("your_") ||
    normalized.includes("<") ||
    normalized.includes(">")
  );
}

function assertStrongSecret(name, minLength) {
  const value = envValue(name);
  if (isPlaceholderValue(value) || value.length < minLength) {
    failProductionConfig(`${name} must be a non-placeholder secret with at least ${minLength} characters`);
  }
}

function parseUrlEnv(name) {
  try {
    return new URL(envValue(name));
  } catch {
    failProductionConfig(`${name} must be a valid URL`);
  }
}

function assertHttpsUrl(name) {
  const parsed = parseUrlEnv(name);
  if (parsed.protocol !== "https:") {
    failProductionConfig(`${name} must use https in production`);
  }
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    failProductionConfig(`${name} must not point to localhost in production`);
  }
  return parsed;
}

function assertFeishuConfig() {
  const appId = envValue("FEISHU_APP_ID");
  const publicAppId = envValue("NEXT_PUBLIC_FEISHU_APP_ID");
  if (!/^cli_[A-Za-z0-9]+$/.test(appId) || appId.startsWith(BAD_FEISHU_APP_PREFIX)) {
    failProductionConfig("FEISHU_APP_ID must be a valid Feishu app id like cli_xxx, not a duplicated cli prefix or a placeholder");
  }
  if (publicAppId !== appId) {
    failProductionConfig("NEXT_PUBLIC_FEISHU_APP_ID must match FEISHU_APP_ID");
  }

  const redirect = assertHttpsUrl("FEISHU_REDIRECT_URI");
  const publicRedirect = assertHttpsUrl("NEXT_PUBLIC_FEISHU_REDIRECT_URI");
  if (redirect.href !== publicRedirect.href) {
    failProductionConfig("NEXT_PUBLIC_FEISHU_REDIRECT_URI must match FEISHU_REDIRECT_URI");
  }
  if (!redirect.pathname.endsWith("/api/auth/feishu/callback")) {
    failProductionConfig("FEISHU_REDIRECT_URI must end with /api/auth/feishu/callback");
  }
}

function assertCorsOrigins() {
  const origins = envValue("CORS_ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    failProductionConfig("CORS_ALLOWED_ORIGINS must contain at least one production origin");
  }
  for (const origin of origins) {
    if (origin === "*") {
      failProductionConfig("CORS_ALLOWED_ORIGINS must not contain '*'");
    }
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      failProductionConfig(`CORS_ALLOWED_ORIGINS contains invalid URL: ${origin}`);
    }
    if (parsed.protocol !== "https:") {
      failProductionConfig("CORS_ALLOWED_ORIGINS must only contain https origins in production");
    }
  }
}

function assertUpstreamAllowlist() {
  const hosts = envValue("UPSTREAM_ALLOWED_HOSTS")
    .split(",")
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  if (hosts.length === 0) {
    failProductionConfig("UPSTREAM_ALLOWED_HOSTS must contain at least one approved provider host");
  }
  for (const host of hosts) {
    if (
      host === "*" ||
      host.includes("/") ||
      host.includes(":") ||
      host === "localhost" ||
      host.endsWith(".local") ||
      !/^[a-z0-9.-]+$/.test(host) ||
      !host.includes(".")
    ) {
      failProductionConfig(`UPSTREAM_ALLOWED_HOSTS contains invalid production host: ${host}`);
    }
  }
}

function assertProductionConfig() {
  if (!isProductionRuntime()) return;

  const missing = [
    "JWT_SECRET",
    "INTERNAL_API_KEY",
    "ENCRYPTION_KEY",
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_REDIRECT_URI",
    "NEXT_PUBLIC_FEISHU_APP_ID",
    "NEXT_PUBLIC_FEISHU_REDIRECT_URI",
    "PUBLIC_PROXY_BASE_URL",
    "CORS_ALLOWED_ORIGINS",
    "ADMIN_IDS",
    "UPSTREAM_ALLOWED_HOSTS",
  ].filter(
    (name) => !envValue(name)
  );
  if (missing.length > 0) {
    failProductionConfig(`Missing required production env vars: ${missing.join(", ")}`);
  }

  const enabledDangerousFlags = PRODUCTION_DISABLED_FLAGS.filter(isTruthyEnv);
  if (enabledDangerousFlags.length > 0) {
    failProductionConfig(`Dangerous production flags must be disabled: ${enabledDangerousFlags.join(", ")}`);
  }

  assertStrongSecret("JWT_SECRET", 32);
  assertStrongSecret("INTERNAL_API_KEY", 32);
  assertStrongSecret("ENCRYPTION_KEY", 32);
  assertStrongSecret("FEISHU_APP_SECRET", 16);
  assertFeishuConfig();
  assertHttpsUrl("PUBLIC_PROXY_BASE_URL");
  assertCorsOrigins();
  assertUpstreamAllowlist();

  const databasePath = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes(":")
    ? process.env.DATABASE_URL
    : null;
  const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || (databasePath ? path.dirname(databasePath) : "");
  if (!dataDir) {
    failProductionConfig("Missing persistent DATABASE_URL or RAILWAY_VOLUME_MOUNT_PATH. Refusing to start with ephemeral data.");
  }
  if (dataDir) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const checkPath = path.join(dataDir, ".sparkloom-write-check");
      fs.writeFileSync(checkPath, String(Date.now()), "utf8");
      fs.unlinkSync(checkPath);
    } catch (err) {
      failProductionConfig(`Persistent data directory is not writable: ${dataDir}. ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function rejectJson(res, statusCode, error) {
  if (!res.headersSent) {
    res.writeHead(statusCode, { "content-type": "application/json" });
  }
  res.end(JSON.stringify({ error }));
}

function startProcess(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...(options.env || {}) },
    cwd: options.cwd || process.cwd(),
  });

  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[railway] ${name} exited with code=${code} signal=${signal}`);
      void shutdown(code || 1);
    }
  });

  return child;
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", resolve);
  });
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (serverListening) {
    server.close();
  }
  const exiting = Array.from(children, waitForExit);
  for (const child of children) {
    child.kill("SIGTERM");
  }

  const timeout = new Promise((resolve) => {
    setTimeout(resolve, 10_000).unref();
  });
  await Promise.race([Promise.all(exiting), timeout]);
  process.exit(code);
}

function targetForPath(pathname) {
  if (pathname === "/health" || pathname.startsWith("/v1") || pathname.startsWith("/anthropic")) {
    return proxyPort;
  }
  return webPort;
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname === "/api/internal" || pathname.startsWith("/api/internal/")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
    rejectJson(res, 413, "Request body too large");
    req.destroy();
    return;
  }

  const targetPort = targetForPath(req.url || "/");
  const headers = { ...req.headers };
  headers.host = req.headers.host || "ai.seapllo.com";
  headers["x-forwarded-host"] = req.headers.host || headers.host;
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "https";

  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  let bodyBytes = 0;
  let rejectedBody = false;

  req.on("data", (chunk) => {
    bodyBytes += chunk.length;
    if (!rejectedBody && bodyBytes > maxRequestBodyBytes) {
      rejectedBody = true;
      proxyReq.destroy();
      rejectJson(res, 413, "Request body too large");
      req.destroy();
    }
  });

  proxyReq.on("error", (error) => {
    if (rejectedBody) return;
    console.error(`[railway] proxy error for ${req.url}:`, error);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "Upstream service unavailable" }));
  });

  req.pipe(proxyReq);
});

assertProductionConfig();

startProcess("web", "node", ["web/server.js"], {
  cwd: "/app/standalone",
  env: {
    PORT: String(webPort),
    HOSTNAME: "127.0.0.1",
  },
});

startProcess("proxy", "node", ["dist/index.js"], {
  cwd: "/app/proxy",
  env: {
    PROXY_PORT: String(proxyPort),
    WEB_URL: `http://127.0.0.1:${webPort}`,
    USAGE_QUEUE_FILE: process.env.USAGE_QUEUE_FILE || "/data/usage-queue.jsonl",
    USAGE_DEAD_LETTER_FILE: process.env.USAGE_DEAD_LETTER_FILE || "/data/usage-dead-letter.jsonl",
  },
});

server.listen(publicPort, "0.0.0.0", () => {
  serverListening = true;
  console.log(`[railway] edge listening on port ${publicPort}`);
  console.log(`[railway] web upstream http://127.0.0.1:${webPort}`);
  console.log(`[railway] proxy upstream http://127.0.0.1:${proxyPort}`);
});
server.on("close", () => {
  serverListening = false;
});

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
