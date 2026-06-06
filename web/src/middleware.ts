import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

/**
 * Next.js 中间件：统一鉴权 + 安全响应头
 *
 * 职责：
 * 1. 所有响应添加安全头（CSP、X-Frame-Options、HSTS 等）
 * 2. /api/admin/* — JWT + admin 角色双重校验
 * 3. /dashboard/* 页面 — JWT cookie 校验，未登录重定向
 * 4. /v1/* 和 /api/proxy/* — 跳过（Bearer token 由路由 handler 校验）
 */

// JWT 配置（与 auth.ts 保持一致）
// 注意：middleware 运行在 Edge Runtime，不能用 Node.js crypto
// 所以开发环境使用确定性 fallback（仅限开发，生产必须配置 JWT_SECRET）
const JWT_SECRET_RAW = process.env.JWT_SECRET || "";
const DANGEROUS_DEFAULTS = [
  "dev-secret-change-in-production",
  "change-me-to-a-random-string",
  "your-random-secret-at-least-32-characters-long",
];
const isUnsafeSecret = !JWT_SECRET_RAW || DANGEROUS_DEFAULTS.includes(JWT_SECRET_RAW);

if (isUnsafeSecret && process.env.NODE_ENV === "production") {
  console.error("[FATAL] JWT_SECRET 未配置，所有鉴权请求将被拒绝");
}

const DEV_FALLBACK_SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6-a7b8-c9d0";

const JWT_SECRET = new TextEncoder().encode(
  isUnsafeSecret ? DEV_FALLBACK_SECRET : JWT_SECRET_RAW
);
const JWT_ISSUER = "ai-token-manager";
const JWT_AUDIENCE = "ai-token-manager:dashboard";

// ===== 安全响应头 =====

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",                          // 禁止 iframe 嵌入（防点击劫持）
  "X-Content-Type-Options": "nosniff",                // 禁止 MIME 嗅探
  "Referrer-Policy": "strict-origin-when-cross-origin", // 控制来源泄露
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()", // 禁用不必要的浏览器 API
  "X-Request-ID": crypto.randomUUID(),                // 每个请求唯一标识，方便追踪
};

// 生产环境才加 HSTS（开发环境没有 HTTPS 会出问题）
function getHstsHeader(): Record<string, string> {
  if (process.env.NODE_ENV === "production") {
    return { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" };
  }
  return {};
}

// CSP 策略
function getCspHeader(): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // unsafe-inline/eval: Next.js 需要
    "style-src 'self' 'unsafe-inline'",                   // Tailwind 需要 inline styles
    "img-src 'self' data: https:",                         // 头像来自外部
    "font-src 'self'",
    "connect-src 'self'",                                    // 浏览器只连本站（代理由服务端转发）
    "frame-ancestors 'none'",                              // 等同 X-Frame-Options: DENY
  ].join("; ");

  return { "Content-Security-Policy": csp };
}

const API_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
};

function applySecurityHeaders(response: NextResponse, isApi: boolean = false): NextResponse {
  const headers = { ...SECURITY_HEADERS, ...getHstsHeader(), ...getCspHeader() };
  if (isApi) {
    Object.assign(headers, API_CACHE_HEADERS);
  }
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

// ===== JWT 解析 =====

interface JwtPayload {
  userId: string;
  feishuId: string;
  name: string;
  role: string;
}

async function verifyJwtFromCookie(request: NextRequest): Promise<JwtPayload | null> {
  const token = request.cookies.get("token")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

function parseRoles(role: string): string[] {
  return (role || "").split(",").map((r) => r.trim()).filter(Boolean);
}

// ===== 路由匹配 =====

function isAdminApi(pathname: string): boolean {
  return pathname.startsWith("/api/admin/");
}

function isDashboardPage(pathname: string): boolean {
  return pathname.startsWith("/dashboard");
}

function isPublicRoute(pathname: string): boolean {
  // 认证相关路由（登录、回调）
  if (pathname.startsWith("/api/auth/")) return true;
  // 代理路由（Bearer token 自行校验）
  if (pathname.startsWith("/v1/")) return true;
  if (pathname.startsWith("/api/proxy/")) return true;
  // 健康检查
  if (pathname === "/api/health") return true;
  // 静态资源
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/favicon")) return true;
  if (pathname.endsWith(".png") || pathname.endsWith(".ico") || pathname.endsWith(".svg")) return true;
  // 根路径和登录页
  if (pathname === "/" || pathname === "/login") return true;
  return false;
}

// ===== 主中间件 =====

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路由：加安全头；API 类路由额外加缓存控制
  if (isPublicRoute(pathname)) {
    const isApiRoute = pathname.startsWith("/api/") || pathname.startsWith("/v1/");
    return applySecurityHeaders(NextResponse.next(), isApiRoute);
  }

  // Dashboard 页面：JWT 校验
  if (isDashboardPage(pathname)) {
    const payload = await verifyJwtFromCookie(request);
    if (!payload) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      return NextResponse.redirect(loginUrl);
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // Admin API：JWT + admin 角色校验
  if (isAdminApi(pathname)) {
    const payload = await verifyJwtFromCookie(request);
    if (!payload) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        true
      );
    }
    const roles = parseRoles(payload.role);
    if (!roles.includes("admin")) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 }),
        true
      );
    }
    return applySecurityHeaders(NextResponse.next(), true);
  }

  // 其他 API 路由（如 /api/usage/*、/api/user/*）：JWT 校验
  if (pathname.startsWith("/api/")) {
    const payload = await verifyJwtFromCookie(request);
    if (!payload) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        true
      );
    }
    return applySecurityHeaders(NextResponse.next(), true);
  }

  // 其他路径：只加安全头
  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，除了：
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     */
    "/((?!_next/static|_next/image).*)",
  ],
};
