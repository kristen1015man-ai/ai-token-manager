import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

/**
 * GET /api/auth/feishu/start
 * 生成随机 state 防 CSRF，存入 HttpOnly cookie，重定向到飞书授权页
 */
export async function GET() {
  const feishuAppId = process.env.NEXT_PUBLIC_FEISHU_APP_ID || "";
  const redirectUri = process.env.NEXT_PUBLIC_FEISHU_REDIRECT_URI || "";

  if (!feishuAppId || !redirectUri) {
    return NextResponse.json({ error: "Feishu OAuth not configured" }, { status: 503 });
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
