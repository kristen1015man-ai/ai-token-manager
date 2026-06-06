import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// ===== JWT Secret 安全校检 =====
const JWT_SECRET_RAW = process.env.JWT_SECRET || "";
const DANGEROUS_DEFAULTS = [
  "dev-secret-change-in-production",
  "change-me-to-a-random-string",
  "your-random-secret-at-least-32-characters-long",
];

const isUnsafeSecret = !JWT_SECRET_RAW || DANGEROUS_DEFAULTS.includes(JWT_SECRET_RAW);

if (isUnsafeSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "[FATAL] JWT_SECRET 未配置或使用了不安全的默认值。请在环境变量中设置一个强随机密钥（至少 32 字符）。"
  );
}

if (isUnsafeSecret) {
  console.warn("[auth] JWT_SECRET 未配置，开发环境使用不安全的 fallback。请配置 JWT_SECRET 环境变量。");
}

// 确保永远不使用可预测的硬编码默认值
// 开发 fallback：一个长随机字符串（仅用于本地开发，绝对不能用于生产）
const DEV_FALLBACK_SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6-a7b8-c9d0";

const JWT_SECRET = new TextEncoder().encode(
  isUnsafeSecret ? DEV_FALLBACK_SECRET : JWT_SECRET_RAW
);
const JWT_ISSUER = "ai-token-manager";
const JWT_AUDIENCE = "ai-token-manager:dashboard";

const TOKEN_NAME = "token";
const TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // 30 天

export interface SessionPayload {
  userId: string;
  feishuId: string;
  name: string;
  role: string;
}

/**
 * 创建 JWT session 并设置 cookie
 */
export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(JWT_SECRET);

  const cookieStore = await cookies();
  cookieStore.set(TOKEN_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TOKEN_MAX_AGE,
    path: "/",
  });

  return token;
}

/**
 * 从 cookie 中验证并解析 session
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_NAME)?.value;

  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * 从 Authorization header 解析 JWT（供中间件使用）
 */
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * 清除 session
 */
export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(TOKEN_NAME);
}
