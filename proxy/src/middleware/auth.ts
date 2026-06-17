import { createMiddleware } from "hono/factory";
import { authenticateApiKey } from "../services/web-internal.js";

/**
 * API Key 认证中间件
 * 从 Authorization: Bearer sk-emp-xxx 提取 Key
 *
 * SEC-02: 使用 HMAC-SHA256 hash 做 SQL WHERE 精确匹配，避免全表扫描。
 * 找到后仍做 timing-safe 二次验证（防碰撞）。
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const xApiKey = c.req.header("x-api-key") || c.req.header("X-Api-Key");
  const apiKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : xApiKey?.trim();

  if (!apiKey) {
    return c.json(
      {
        error: {
          message: "Missing or invalid API key. Use Authorization: Bearer sk-emp-xxx or x-api-key: sk-emp-xxx",
          type: "authentication_error",
        },
      },
      401
    );
  }

  if (!apiKey.startsWith("sk-emp-")) {
    return c.json(
      {
        error: {
          message: "Invalid API key format. Key must start with sk-emp-",
          type: "authentication_error",
        },
      },
      401
    );
  }

  try {
    const matchedUser = await authenticateApiKey(apiKey);
    if (!matchedUser) {
      return c.json(
        {
          error: {
            message: "Invalid API key",
            type: "authentication_error",
          },
        },
        401
      );
    }

    // 注入用户信息到 context
    c.set("userId", matchedUser.id);
    c.set("userName", matchedUser.name);
    c.set("userRole", matchedUser.role);

    await next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return c.json(
      {
        error: {
          message: "Internal authentication error",
          type: "internal_error",
        },
      },
      500
    );
  }
});
