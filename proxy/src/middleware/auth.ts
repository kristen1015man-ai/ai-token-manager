import { createMiddleware } from "hono/factory";
import { getDb } from "../../../shared/db.js";
import { users } from "../../../shared/schema.js";
import { ensureDecrypted, safeEqual } from "../../../shared/crypto.js";

/**
 * API Key 认证中间件
 * 从 Authorization: Bearer sk-emp-xxx 提取 Key
 *
 * 注意：users.apiKey 可能以 AES-256-GCM 加密存储（enc:v1: 前缀），
 * 无法直接 SQL 匹配（因为每次加密的 IV 不同，密文不同），
 * 所以需要加载所有用户后内存解密比较。
 * 使用 timingSafeEqual 防止时序攻击。
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
    // apiKey 可能已加密存储，无法直接 SQL 匹配，需加载所有用户后内存比对
    const allUsers = await db.select().from(users);

    let matchedUser: typeof allUsers[0] | null = null;
    for (const user of allUsers) {
      const decryptedKey = ensureDecrypted(user.apiKey);
      if (safeEqual(decryptedKey, apiKey)) {
        matchedUser = user;
        break;
      }
    }

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
