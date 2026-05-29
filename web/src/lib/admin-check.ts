import { NextResponse } from "next/server";
import { getSession } from "./auth";

/**
 * 检查当前用户是否为管理员
 * 返回 null 如果是管理员，否则返回 403 Response
 */
export async function requireAdmin() {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, error: null };
}
