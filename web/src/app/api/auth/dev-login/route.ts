import { NextRequest, NextResponse } from "next/server";
import { createSession } from "../../../../lib/auth";

/**
 * 本地开发快捷登录 — 以何广明（admin）身份登录
 * 访问 http://localhost:3000/api/auth/dev-login 即可
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  await createSession({
    userId: "u_051",
    feishuId: "ou_f2e284bb6701647e664c938806b08627",
    name: "何广明",
    role: "admin",
  });

  const host = request.headers.get("host") || "localhost:3000";
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  return NextResponse.redirect(new URL("/dashboard/admin", `${protocol}://${host}`));
}
