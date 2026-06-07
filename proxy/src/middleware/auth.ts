import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { getDb } from "../../../shared/db.js";
import { users } from "../../../shared/schema.js";
import { ensureDecrypted, safeEqual, searchableHash } from "../../../shared/crypto.js";

/**
 * API Key 认证中间件
 * 从 Authorization: Bearer sk-emp-xxx 提取 Key
 *
 * SEC-02: 使用 HMAC-SHA256 hash 做 SQL WHERE 精确匹配，避免全表扫描。
 * 找到后仍做 timing-safe 二次验证（防碰撞）。
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: {
          message: "Missing or invalid Authorization header. Use: Bearer sk-xxx",
          type: "authentication_error",
        },
      },
      401
    );
  }

  const apiKey = authHeader.slice(7).trim();
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
    const { db } = await getDb();
    // SEC-02: hash → SQL 精确匹配，不再全表扫描
    const hash = searchableHash(apiKey);
    const candidates = await db
      .select()
      .from(users)
      .where(eq(users.apiKeyHash, hash))
      .limit(1);

    if (candidates.length === 0) {
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

    // 二次验证：timing-safe 比对确认（防碰撞）
    const matchedUser = candidates[0];
    const decryptedKey = ensureDecrypted(matchedUser.apiKey);
    if (!safeEqual(decryptedKey, apiKey)) {
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

    if (matchedUser.status === "disabled") {
      return c.json(
        {
          error: {
            message: "Your account has been disabled. Contact admin.",
            type: "authentication_error",
          },
        },
        403
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
