import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { canAccess } from "./lib/permissions";

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
const allowInsecureDevAuth =
  process.env.NODE_ENV !== "production" && process.env.ALLOW_INSECURE_DEV_AUTH === "true";

if (isUnsafeSecret && !allowInsecureDevAuth) {
  console.error("[FATAL] JWT_SECRET 未配置或使用了默认值，所有鉴权请求将被拒绝");
}

const DEV_FALLBACK_SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6-a7b8-c9d0";

// 生产环境不安全密钥 → 强制拒绝鉴权（不回退到 dev secret）
const JWT_SECRET = new TextEncoder().encode(
  isUnsafeSecret
    ? (allowInsecureDevAuth ? DEV_FALLBACK_SECRET : crypto.randomUUID())
    : JWT_SECRET_RAW
);
const JWT_ISSUER = "ai-token-manager";
const JWT_AUDIENCE = "ai-token-manager:dashboard";

// ===== 安全响应头 =====

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",                          // 禁止 iframe 嵌入（防点击劫持）
  "X-Content-Type-Options": "nosniff",                // 禁止 MIME 嗅探
  "Referrer-Policy": "strict-origin-when-cross-origin", // 控制来源泄露
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()", // 禁用不必要的浏览器 API
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
    "connect-src 'self' http://127.0.0.1:39271 http://localhost:39271 ws://127.0.0.1:39271 ws://localhost:39271",
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
  response.headers.set("X-Request-ID", crypto.randomUUID());
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

function isStudioPage(pathname: string): boolean {
  return pathname === "/studio" || pathname.startsWith("/studio/");
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
  if (pathname === "/" || pathname === "/login" || pathname === "/download") return true;
  return false;
}

// ===== INTERNAL_API_KEY 校验 =====

/**
 * 检查请求是否携带有效的 INTERNAL_API_KEY Bearer token。
 * auto-sync 定时任务通过此方式调用自身 API，绕过 JWT session 校验。
 */
const internalAuthEncoder = new TextEncoder();

function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = internalAuthEncoder.encode(a);
  const bBytes = internalAuthEncoder.encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;

  for (let i = 0; i < length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }

  return diff === 0;
}

function isInternalApiRequest(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/api/internal/")) {
    return false;
  }
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) return false;
  const authHeader = request.headers.get("Authorization") || "";
  return constantTimeEqual(authHeader, `Bearer ${internalKey}`);
}

// ===== CSRF / Origin 校验 =====

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const configuredAllowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => Boolean(origin))
);

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function getRequestOrigin(request: NextRequest): string | null {
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const proto = forwardedProto || request.nextUrl.protocol.replace(/:$/, "") || "https";
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  return normalizeOrigin(`${proto}://${host}`);
}

function isTrustedRequestOrigin(request: NextRequest): boolean {
  const origin = normalizeOrigin(request.headers.get("origin"));
  const referer = normalizeOrigin(request.headers.get("referer"));
  const candidate = origin || referer;
  if (!candidate) return false;

  const requestOrigin = getRequestOrigin(request);
  const nextOrigin = normalizeOrigin(request.nextUrl.origin);
  return Boolean(
    candidate === requestOrigin ||
      candidate === nextOrigin ||
      configuredAllowedOrigins.has(candidate)
  );
}

function needsOriginCheck(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/api/")) return false;
  if (pathname === "/api/health") return false;
  if (pathname.startsWith("/api/proxy/")) return false;
  return true;
}

function rejectInvalidOrigin(): NextResponse {
  return applySecurityHeaders(
    NextResponse.json({ error: "Invalid request origin" }, { status: 403 }),
    true
  );
}

// ===== 主中间件 =====

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 内部定时任务/API 使用 Bearer key，先于 CSRF 放行。
  if (isInternalApiRequest(request)) {
    const isApiRoute = pathname.startsWith("/api/");
    return applySecurityHeaders(NextResponse.next(), isApiRoute);
  }

  // Cookie 鉴权 API 的写操作必须来自可信同源，避免 CSRF 写入/删除/同步操作。
  if (needsOriginCheck(request) && !isTrustedRequestOrigin(request)) {
    return rejectInvalidOrigin();
  }

  // 公开路由：加安全头；API 类路由额外加缓存控制
  if (isPublicRoute(pathname)) {
    const isApiRoute = pathname.startsWith("/api/") || pathname.startsWith("/v1/");
    return applySecurityHeaders(NextResponse.next(), isApiRoute);
  }

  // Dashboard / Studio 页面：JWT 校验
  if (isDashboardPage(pathname) || isStudioPage(pathname)) {
    const payload = await verifyJwtFromCookie(request);
    if (!payload) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      return NextResponse.redirect(loginUrl);
    }
    if (!canAccess(payload.role, pathname)) {
      const fallbackUrl = request.nextUrl.clone();
      fallbackUrl.pathname = "/dashboard";
      return NextResponse.redirect(fallbackUrl);
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // Admin API：middleware 只校验登录态，具体角色由 route handler 的 requireRole/requireAdmin 决定。
  if (isAdminApi(pathname)) {
    const payload = await verifyJwtFromCookie(request);
    if (!payload) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
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
