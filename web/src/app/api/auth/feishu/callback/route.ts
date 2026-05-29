import { NextRequest, NextResponse } from "next/server";
import { getUserAccessToken, getUserInfo } from "../../../../../lib/feishu";
import { findOrCreateUser } from "../../../../../lib/user-service";
import { createSession } from "../../../../../lib/auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=no_code", request.url));
  }

  try {
    // 1. 用 code 换 access_token
    const tokenData = await getUserAccessToken(code);
    const accessToken = tokenData?.access_token;

    if (!accessToken) {
      throw new Error("No access token returned");
    }

    // 2. 获取用户信息
    const userInfo = await getUserInfo(accessToken);
    if (!userInfo) {
      throw new Error("No user info returned");
    }

    // 3. 创建或更新用户
    const user = await findOrCreateUser({
      open_id: userInfo.open_id ?? "",
      name: userInfo.name ?? undefined,
      avatar_url: userInfo.avatar_url ?? undefined,
      email: userInfo.email ?? undefined,
      employee_no: userInfo.employee_no ?? undefined,
    });

    if (!user) {
      throw new Error("Failed to create user");
    }

    // 4. 创建 session
    await createSession({
      userId: user.id,
      feishuId: user.feishuId,
      name: user.name,
      role: user.role,
    });

    // 5. 重定向到仪表盘
    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (error) {
    console.error("Feishu OAuth callback error:", error);
    return NextResponse.redirect(
      new URL("/login?error=auth_failed", request.url)
    );
  }
}
