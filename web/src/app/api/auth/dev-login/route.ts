import { NextRequest, NextResponse } from "next/server";
import { createSession } from "../../../../lib/auth";

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
 * 本地开发快捷登录 — 以何广明（admin）身份登录
 * 访问 http://localhost:3000/api/auth/dev-login 即可
 */
export async function GET(request: NextRequest) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_DEV_LOGIN !== "true" ||
    !isLocalRequest(request)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
