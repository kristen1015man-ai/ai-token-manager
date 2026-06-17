import { NextRequest, NextResponse } from "next/server";

/**
 * 统一 API 错误处理 wrapper
 *
 * 用法：
 *   export const GET = apiHandler(async (req) => { ... });
 *   export const POST = apiHandler(async (req) => { ... });
 *
 * 自动捕获未处理异常，返回标准 JSON 错误响应。
 * 生产环境不暴露内部错误细节，开发环境显示完整信息。
 */
export function apiHandler(
  handler: (req: NextRequest) => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    try {
      return await handler(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const stack = err instanceof Error ? err.stack : undefined;

      console.error(`[API Error] ${req.method} ${req.nextUrl.pathname}:`, message);

      // 生产环境只返回通用错误，避免泄漏内部信息
      const isDev = process.env.NODE_ENV !== "production";

      return NextResponse.json(
        {
          error: isDev ? message : "服务器内部错误，请稍后重试",
          ...(isDev && stack ? { stack: stack.split("\n").slice(0, 5).join("\n") } : {}),
        },
        { status: 500 }
      );
    }
  };
}

/**
 * 无请求体的 handler（如 GET 不需要解析 body）
 * 用法：export const GET = apiHandlerNoBody(async () => { ... });
 */
export function apiHandlerNoBody(
  handler: () => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse> {
  return async (_req: NextRequest) => {
    try {
      return await handler();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[API Error] GET:`, message);

      const isDev = process.env.NODE_ENV !== "production";
      return NextResponse.json(
        { error: isDev ? message : "服务器内部错误，请稍后重试" },
        { status: 500 }
      );
    }
  };
}
