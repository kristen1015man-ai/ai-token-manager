/**
 * CORS 安全配置
 * 从环境变量 CORS_ALLOWED_ORIGINS 读取白名单（逗号分隔）
 * 未配置时开发环境允许 localhost，生产环境拒绝跨域
 */

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** 开发环境默认允许的来源 */
const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

/**
 * 判断请求来源是否在白名单中
 */
function isOriginAllowed(origin: string): boolean {
  const origins =
    ALLOWED_ORIGINS.length > 0
      ? ALLOWED_ORIGINS
      : process.env.NODE_ENV !== "production"
        ? DEV_ORIGINS
        : [];

  return origins.includes(origin);
}

/**
 * 构建 CORS 响应头
 * 如果来源不在白名单，返回空对象（浏览器会阻止跨域）
 */
export function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  if (!requestOrigin || !isOriginAllowed(requestOrigin)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": requestOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400", // 24 小时预检缓存
  };
}

/**
 * 返回 OPTIONS 预检响应
 */
export function corsOptionsResponse(request: Request): Response {
  const origin = request.headers.get("Origin");
  const headers = getCorsHeaders(origin);

  return new Response(null, {
    status: 204,
    headers,
  });
}
