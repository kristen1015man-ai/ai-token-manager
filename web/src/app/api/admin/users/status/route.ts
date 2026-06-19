import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { auditLog } from "../../../../../lib/audit-log";
import { getDb, getRawExec, saveDb } from "../../../../../lib/db";
import { parseRoles } from "../../../../../lib/permissions";

function likePattern(value: string): string {
  return `%${value.replace(/[%_]/g, "\\$&")}%`;
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const status = request.nextUrl.searchParams.get("status")?.trim() || "disabled";
  const query = request.nextUrl.searchParams.get("query")?.trim() || "";
  if (!["active", "disabled", "all"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  const where: string[] = [];
  const params: unknown[] = [];
  if (status !== "all") {
    where.push("status = ?");
    params.push(status);
  }
  if (query) {
    where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR feishu_id LIKE ? ESCAPE '\\')");
    const pattern = likePattern(query);
    params.push(pattern, pattern, pattern);
  }

  const rows = db.exec(
    `SELECT id, name, email, department, status, role, feishu_id, updated_at
     FROM users
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY updated_at DESC
     LIMIT 100`,
    params
  );

  return NextResponse.json({
    users: (rows[0]?.values || []).map((row) => ({
      id: String(row[0]),
      name: String(row[1] || ""),
      email: String(row[2] || ""),
      department: String(row[3] || ""),
      status: String(row[4] || "active"),
      role: String(row[5] || "member"),
      feishuId: String(row[6] || ""),
      updatedAt: Number(row[7] || 0),
    })),
  });
}

export async function PATCH(request: NextRequest) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  let body: { userId?: unknown; status?: unknown; reason?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!userId || !["active", "disabled"].includes(status)) {
    return NextResponse.json({ error: "Missing userId or invalid status" }, { status: 400 });
  }
  if (reason.length < 6) {
    return NextResponse.json({ error: "Reason must be at least 6 characters" }, { status: 400 });
  }
  if (userId === session.userId && status === "disabled") {
    return NextResponse.json({ error: "Cannot disable your own account" }, { status: 400 });
  }

  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  const targetRows = db.exec(
    "SELECT id, name, email, department, status, role FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  const target = targetRows[0]?.values?.[0];
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const previousStatus = String(target[4] || "active");
  const role = String(target[5] || "member");
  if (previousStatus === status) {
    return NextResponse.json({ success: true, unchanged: true });
  }

  if (status === "disabled" && parseRoles(role).includes("admin")) {
    const adminRows = db.exec("SELECT id, role FROM users WHERE status = 'active'");
    const activeAdminCount = (adminRows[0]?.values || [])
      .filter((row) => parseRoles(String(row[1] || "member")).includes("admin"))
      .length;
    if (activeAdminCount <= 1) {
      return NextResponse.json({ error: "At least one active admin must remain" }, { status: 400 });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  db.exec("UPDATE users SET status = ?, updated_at = ? WHERE id = ?", [status, now, userId]);
  await saveDb();
  await auditLog(session.userId, "update", "user", userId, {
    action: "admin_update_user_status",
    from: previousStatus,
    to: status,
    reason,
    targetUser: {
      id: userId,
      name: String(target[1] || ""),
      email: String(target[2] || ""),
      department: String(target[3] || ""),
      role,
    },
  });

  return NextResponse.json({ success: true, userId, status });
}
