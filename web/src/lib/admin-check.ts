import { NextResponse } from "next/server";
import { getSession } from "./auth";
import { parseRoles } from "./permissions";

/**
 * 检查当前用户是否为管理员（支持多角色）
 */
export async function requireAdmin() {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const roles = parseRoles(session.role);
  if (!roles.includes("admin")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, error: null };
}

/**
 * 检查当前用户是否拥有指定角色之一（支持多角色，任一匹配即可）
 * @param roles 允许的角色列表
 */
export async function requireRole(...roles: string[]) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userRoles = parseRoles(session.role);
  if (!userRoles.some((r) => roles.includes(r))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, error: null };
}
