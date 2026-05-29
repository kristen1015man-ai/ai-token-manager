import { createMiddleware } from "hono/factory";
import { getDb } from "../../../shared/db.js";
import { users } from "../../../shared/schema.js";
import { eq } from "drizzle-orm";

/**
 * API Key 认证中间件
 * 从 Authorization: Bearer sk-emp-xxx 提取 Key
 * 查询数据库验证用户身份和状态
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: {
          message: "Missing or invalid Authorization header. Use: Bearer sk-emp-xxx",
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
    const result = await db
      .select()
      .from(users)
      .where(eq(users.apiKey, apiKey))
      .limit(1);

    if (result.length === 0) {
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

    const user = result[0];
    if (user.status === "disabled") {
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
    c.set("userId", user.id);
    c.set("userName", user.name);
    c.set("userRole", user.role);

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
