import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

function isLocalRequest(request: NextRequest): boolean {
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return (
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:") ||
    host === "[::1]" ||
    host.startsWith("[::1]:")
  );
}

/**
 * GET /api/auth/feishu/start
 * 生成随机 state 防 CSRF，存入 HttpOnly cookie，重定向到飞书授权页
 */
export async function GET(request: NextRequest) {
  const feishuAppId = process.env.NEXT_PUBLIC_FEISHU_APP_ID || "";
  const redirectUri = process.env.NEXT_PUBLIC_FEISHU_REDIRECT_URI || "";

  if (!feishuAppId || !redirectUri) {
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.ENABLE_DEV_LOGIN === "true" &&
      isLocalRequest(request)
    ) {
      return NextResponse.redirect(new URL("/api/auth/dev-login?next=/studio", request.url));
    }

    return NextResponse.redirect(new URL("/login?error=feishu_config", request.url));
  }

  // 生成 32 字节随机 state，防 CSRF
  const state = randomBytes(32).toString("hex");

  const feishuAuthUrl =
    `https://open.feishu.cn/open-apis/authen/v1/authorize` +
    `?app_id=${feishuAppId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=${state}`;

  const response = NextResponse.redirect(feishuAuthUrl);

  // 将 state 存入 HttpOnly + Secure + SameSite=Lax cookie
  response.cookies.set("feishu_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 分钟有效
    path: "/",
  });

  return response;
}
