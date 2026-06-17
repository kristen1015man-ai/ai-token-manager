import { NextResponse } from "next/server";
import { getSession } from "./auth";
import { parseRoles } from "./permissions";
import { getDb } from "./db";
import { users } from "../../../shared/schema";
import { eq } from "drizzle-orm";

export async function getFreshSession() {
  const session = await getSession();
  if (!session) return null;

  const { db } = await getDb();
  const result = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = result[0];
  if (!user || user.status !== "active") return null;

  return {
    ...session,
    role: user.role,
    departmentId: user.departmentId,
    department: user.department,
  };
}

export async function requireActiveSession() {
  const session = await getFreshSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session, error: null };
}

/**
 * 检查当前用户是否为管理员（支持多角色）
 */
export async function requireAdmin() {
  const session = await getFreshSession();
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
  const session = await getFreshSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userRoles = parseRoles(session.role);
  if (!userRoles.some((r) => roles.includes(r))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, error: null };
}
