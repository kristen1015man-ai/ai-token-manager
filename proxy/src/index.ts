import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve, type ServerType } from "@hono/node-server";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import anthropicRoutes from "./routes/anthropic.js";
import anthropicModelRoutes from "./routes/anthropic-models.js";
import chatRoutes from "./routes/chat.js";
import modelRoutes from "./routes/models.js";
import { clearUsageQueue, flushUsageToWeb, getUsageQueueHealth } from "./services/usage.js";
import { checkWebHealth, getProxyHealth } from "./services/web-internal.js";

const app = new Hono();
const PORT = parseInt(process.env.PROXY_PORT || "3001");
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const RESET_CONFIRM_HEADER = "x-sparkloom-maintenance-confirm";
const RESET_CONFIRM_VALUE = "reset-billing-usage";
const DANGEROUS_DEFAULTS = new Set([
  "dev-secret-change-in-production",
  "change-me-to-a-random-string",
  "your-random-secret-at-least-32-characters-long",
  "xxx",
]);

function envValue(name: string): string {
  return (process.env[name] || "").trim();
}

function failProductionConfig(message: string): never {
  console.error(`[ProxyConfig] ${message}`);
  process.exit(1);
}

function isProductionRuntime(): boolean {
  return envValue("NODE_ENV") === "production" || envValue("RAILWAY_ENVIRONMENT_NAME") === "production";
}

function isPlaceholderValue(value: string): boolean {
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

function assertStrongSecret(name: string, minLength: number): void {
  const value = envValue(name);
  if (isPlaceholderValue(value) || value.length < minLength) {
    failProductionConfig(`${name} must be a non-placeholder secret with at least ${minLength} characters`);
  }
}

function assertWebUrl(): void {
  try {
    const parsed = new URL(envValue("WEB_URL"));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      failProductionConfig("WEB_URL must use http or https");
    }
  } catch {
    failProductionConfig("WEB_URL must be a valid URL");
  }
}

function assertCorsOrigins(): void {
  if (allowedOrigins.length === 0) {
    failProductionConfig("CORS_ALLOWED_ORIGINS must contain at least one production origin");
  }
  for (const origin of allowedOrigins) {
    if (origin === "*") {
      failProductionConfig("CORS_ALLOWED_ORIGINS must not contain '*'");
    }
    let parsed: URL;
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

function assertUpstreamAllowlist(): void {
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

function assertProxyProductionConfig(): void {
  if (!isProductionRuntime()) return;
  const missing = ["INTERNAL_API_KEY", "ENCRYPTION_KEY", "WEB_URL", "CORS_ALLOWED_ORIGINS", "UPSTREAM_ALLOWED_HOSTS"]
    .filter((name) => !envValue(name));
  if (missing.length > 0) {
    failProductionConfig(`Missing required production env vars: ${missing.join(", ")}`);
  }
  assertStrongSecret("INTERNAL_API_KEY", 32);
  assertStrongSecret("ENCRYPTION_KEY", 32);
  assertWebUrl();
  assertCorsOrigins();
  assertUpstreamAllowlist();
}

assertProxyProductionConfig();

function hasInternalAuth(authHeader?: string): boolean {
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey || !authHeader) return false;
  const expected = `Bearer ${internalKey}`;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(authHeader);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

// 全局中间件
app.use("*", logger());
app.use("*", cors({
  origin: (origin) => {
    const allowed = allowedOrigins.length > 0
      ? allowedOrigins
      : ["http://localhost:3000", "http://127.0.0.1:3000"];
    if (!origin || allowed.includes(origin)) return origin;
    return null;
  },
  credentials: true,
}));

// 健康检查（不需要认证）
app.get("/health", async (c) => {
  const detailed = hasInternalAuth(c.req.header("authorization"));
  const config = getProxyHealth();
  const web = await checkWebHealth();
  const usageQueue = getUsageQueueHealth();
  const ok =
    config.internalKeyConfigured &&
    web.ok &&
    usageQueue.persistedQueueConfigured &&
    usageQueue.queueWritable.ok &&
    usageQueue.deadLetterWritable.ok;
  if (!detailed) {
    return c.json({
      status: ok ? "ok" : "degraded",
      service: "ai-token-proxy",
      timestamp: new Date().toISOString(),
    }, ok ? 200 : 503);
  }

  return c.json({
    status: ok ? "ok" : "degraded",
    service: "ai-token-proxy",
    version: "0.1.0",
    config,
    web,
    usageQueue,
  }, ok ? 200 : 503);
});

app.post("/internal/admin/usage-queue/clear", async (c) => {
  if (!hasInternalAuth(c.req.header("authorization"))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (process.env.ENABLE_PROXY_USAGE_QUEUE_CLEAR !== "true") {
    return c.json({
      error: "Proxy usage queue clear is disabled. Set ENABLE_PROXY_USAGE_QUEUE_CLEAR=true only during an approved maintenance window.",
    }, 403);
  }
  if (c.req.header(RESET_CONFIRM_HEADER) !== RESET_CONFIRM_VALUE) {
    return c.json({ error: `Missing ${RESET_CONFIRM_HEADER}: ${RESET_CONFIRM_VALUE}` }, 400);
  }
  const result = clearUsageQueue();
  return c.json({ success: true, ...result });
});

// ===== OpenAI 兼容接口 =====

// /v1/models — 需要 API Key 认证
app.use("/v1/models", authMiddleware);
app.route("/v1/models", modelRoutes);

// /v1/chat/completions — 认证 + 限频 + 限额检查
app.use("/v1/chat/completions", authMiddleware);
app.use("/v1/chat/completions", rateLimitMiddleware);
app.route("/v1/chat/completions", chatRoutes);

app.use("/anthropic/v1/messages", authMiddleware);
app.use("/anthropic/v1/messages", rateLimitMiddleware);
app.use("/anthropic/v1/messages/*", authMiddleware);
app.use("/anthropic/v1/messages/*", rateLimitMiddleware);
app.route("/anthropic/v1/messages", anthropicRoutes);

app.use("/anthropic/v1/models", authMiddleware);
app.route("/anthropic/v1/models", anthropicModelRoutes);

// 404 兜底
app.notFound((c) => {
  return c.json(
    {
      error: {
        message: `Unknown endpoint: ${c.req.method} ${c.req.path}`,
        type: "not_found",
      },
    },
    404
  );
});

// 启动服务器
console.log(`🚀 AI Token Proxy starting on port ${PORT}`);
const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
console.log(`✅ Proxy ready at http://localhost:${PORT}`);
console.log(`   Health: http://localhost:${PORT}/health`);
console.log(`   Models: http://localhost:${PORT}/v1/models`);
console.log(`   Chat:   http://localhost:${PORT}/v1/chat/completions`);
console.log(`   Anthropic: http://localhost:${PORT}/anthropic/v1/messages`);
console.log(`   Anthropic Models: http://localhost:${PORT}/anthropic/v1/models`);

// GRACEFUL-01: 优雅关停 — flush 用量记录、关闭 HTTP 连接
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);

  // 1. 停止接受新连接
  server.close();
  console.log("[Shutdown] HTTP server stopped accepting new connections");

  // 2. 刷新待发送的用量记录
  try {
    await flushUsageToWeb();
    console.log("[Shutdown] Usage records flushed");
  } catch (err) {
    console.error("[Shutdown] Failed to flush usage records:", err);
  }

  console.log("[Shutdown] Complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
