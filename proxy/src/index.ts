import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve, type ServerType } from "@hono/node-server";
import { authMiddleware } from "./middleware/auth.js";
import { quotaMiddleware } from "./middleware/quota.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import chatRoutes from "./routes/chat.js";
import modelRoutes from "./routes/models.js";
import { flushUsageToWeb } from "./services/usage.js";

const app = new Hono();
const PORT = parseInt(process.env.PROXY_PORT || "3001");

// 全局中间件
app.use("*", logger());
app.use("*", cors({
  origin: (origin) => {
    // 允许管理后台和本地开发访问
    const allowed = [
      process.env.WEB_URL || "http://localhost:3000",
      "http://localhost:3000",
    ];
    if (!origin || allowed.includes(origin)) return origin;
    return null;
  },
  credentials: true,
}));

// 健康检查（不需要认证）
app.get("/health", (c) => {
  return c.json({ status: "ok", service: "ai-token-proxy", version: "0.1.0" });
});

// ===== OpenAI 兼容接口 =====

// /v1/models — 需要 API Key 认证
app.use("/v1/models", authMiddleware);
app.route("/v1/models", modelRoutes);

// /v1/chat/completions — 认证 + 限频 + 限额检查
app.use("/v1/chat/completions", authMiddleware);
app.use("/v1/chat/completions", rateLimitMiddleware);
app.use("/v1/chat/completions", quotaMiddleware);
app.route("/v1/chat/completions", chatRoutes);

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
