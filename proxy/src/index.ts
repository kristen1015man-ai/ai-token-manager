import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createDb } from "../../shared/db.js";

const app = new Hono();
const PORT = parseInt(process.env.PROXY_PORT || "3001");

// 初始化数据库
const dbPath = process.env.DATABASE_URL || "./data.db";
const db = createDb(dbPath);

// 全局中间件
app.use("*", logger());
app.use("*", cors({ origin: "*" }));

// 健康检查
app.get("/health", (c) => {
  return c.json({ status: "ok", service: "ai-token-proxy" });
});

// OpenAI 兼容的 models 接口（占位，Phase 2 实现）
app.get("/v1/models", (c) => {
  return c.json({
    object: "list",
    data: [],
  });
});

// OpenAI 兼容的 chat 接口（占位，Phase 2 实现）
app.post("/v1/chat/completions", (c) => {
  return c.json(
    {
      error: {
        message: "Proxy core not yet implemented (Phase 2)",
        type: "not_implemented",
      },
    },
    501
  );
});

// 启动服务器
console.log(`🚀 AI Token Proxy starting on port ${PORT}`);
export default {
  port: PORT,
  fetch: app.fetch,
};
