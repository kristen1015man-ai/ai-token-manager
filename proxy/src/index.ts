import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { authMiddleware } from "./middleware/auth.js";
import { quotaMiddleware } from "./middleware/quota.js";
import chatRoutes from "./routes/chat.js";
import modelRoutes from "./routes/models.js";

const app = new Hono();
const PORT = parseInt(process.env.PROXY_PORT || "3001");

// 全局中间件
app.use("*", logger());
app.use("*", cors({ origin: "*" }));

// 健康检查（不需要认证）
app.get("/health", (c) => {
  return c.json({ status: "ok", service: "ai-token-proxy", version: "0.1.0" });
});

// ===== OpenAI 兼容接口 =====

// /v1/models — 需要 API Key 认证
app.use("/v1/models", authMiddleware);
app.route("/v1/models", modelRoutes);

// /v1/chat/completions — 认证 + 限额检查
app.use("/v1/chat/completions", authMiddleware);
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
serve({ fetch: app.fetch, port: PORT });
console.log(`✅ Proxy ready at http://localhost:${PORT}`);
console.log(`   Health: http://localhost:${PORT}/health`);
console.log(`   Models: http://localhost:${PORT}/v1/models`);
console.log(`   Chat:   http://localhost:${PORT}/v1/chat/completions`);
