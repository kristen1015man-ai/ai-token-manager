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

function assertProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;

  const missing = [
    "JWT_SECRET",
    "INTERNAL_API_KEY",
    "ENCRYPTION_KEY",
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_REDIRECT_URI",
  ].filter(
    (name) => !process.env[name]
  );
  if (missing.length > 0) {
    console.error(`[railway] Missing required production env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const databasePath = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes(":")
    ? process.env.DATABASE_URL
    : null;
  const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || (databasePath ? path.dirname(databasePath) : "");
  if (!dataDir && process.env.ALLOW_EPHEMERAL_DATA !== "true") {
    console.error("[railway] Missing persistent DATABASE_URL or RAILWAY_VOLUME_MOUNT_PATH. Refusing to start with ephemeral data.");
    process.exit(1);
  }
  if (dataDir) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const checkPath = path.join(dataDir, ".sparkloom-write-check");
      fs.writeFileSync(checkPath, String(Date.now()), "utf8");
      fs.unlinkSync(checkPath);
    } catch (err) {
      console.error(`[railway] Persistent data directory is not writable: ${dataDir}`, err);
      process.exit(1);
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
