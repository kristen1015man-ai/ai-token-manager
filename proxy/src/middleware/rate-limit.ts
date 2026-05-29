import { createMiddleware } from "hono/factory";

const LIMIT_WINDOW = 60_000; // 1 分钟窗口
const MAX_REQUESTS = 60; // 每分钟最多 60 次

// 内存滑动窗口：userId → 时间戳数组
const windows = new Map<string, number[]>();

function cleanup(userId: string, now: number) {
  const timestamps = windows.get(userId) || [];
  const cutoff = now - LIMIT_WINDOW;
  const filtered = timestamps.filter((t) => t > cutoff);
  windows.set(userId, filtered);
  return filtered;
}

/**
 * 请求频率限制中间件
 * 基于用户 ID 的内存滑动窗口，每分钟最多 60 次请求
 */
export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  const userId = c.get("userId");
  const now = Date.now();

  const timestamps = cleanup(userId, now);

  if (timestamps.length >= MAX_REQUESTS) {
    return c.json(
      {
        error: {
          message: "请求过于频繁，请稍后再试",
          type: "rate_limit_exceeded",
          retry_after_seconds: Math.ceil((timestamps[0] + LIMIT_WINDOW - now) / 1000),
        },
      },
      429
    );
  }

  timestamps.push(now);
  windows.set(userId, timestamps);

  await next();
});
