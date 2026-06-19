import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { auditLog } from "../../../../lib/audit-log";
import { getDb, getRawExec, saveDb } from "../../../../lib/db";
import { adminRevokeUserApiKey, ensureUserApiKeysTable, listUserApiKeys } from "../../../../lib/user-api-keys";

function likePattern(value: string): string {
  return `%${value.replace(/[%_]/g, "\\$&")}%`;
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  ensureUserApiKeysTable(db);

  const userId = request.nextUrl.searchParams.get("userId")?.trim() || "";
  const query = request.nextUrl.searchParams.get("query")?.trim() || "";
  const includeDisabled = request.nextUrl.searchParams.get("includeDisabled") === "true";

  const where: string[] = [];
  const params: unknown[] = [];
  if (userId) {
    where.push("u.id = ?");
    params.push(userId);
  }
  if (!includeDisabled) {
    where.push("u.status = 'active'");
  }
  if (query) {
    where.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.feishu_id LIKE ? ESCAPE '\\')");
    const pattern = likePattern(query);
    params.push(pattern, pattern, pattern);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.exec(
    `SELECT u.id, u.name, u.email, u.department, u.status, u.feishu_id, COUNT(k.id) AS key_count
     FROM users u
     LEFT JOIN user_api_keys k ON k.user_id = u.id
     ${whereClause}
     GROUP BY u.id
     ORDER BY u.status ASC, u.name ASC
     LIMIT 100`,
    params
  );

  const users = (rows[0]?.values || []).map((row) => {
    const id = String(row[0]);
    return {
      id,
      name: String(row[1] || ""),
      email: String(row[2] || ""),
      department: String(row[3] || ""),
      status: String(row[4] || "active"),
      feishuId: String(row[5] || ""),
      keyCount: Number(row[6] || 0),
      keys: userId ? listUserApiKeys(db, id) : undefined,
    };
  });

  return NextResponse.json({ users });
}

export async function DELETE(request: NextRequest) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  let body: { userId?: unknown; keyId?: unknown; reason?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!userId || !keyId) {
    return NextResponse.json({ error: "Missing userId or keyId" }, { status: 400 });
  }
  if (reason.length < 6) {
    return NextResponse.json({ error: "Reason must be at least 6 characters" }, { status: 400 });
  }

  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  const userRows = db.exec(
    "SELECT id, name, email, status FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  const user = userRows[0]?.values?.[0];
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  try {
    const result = adminRevokeUserApiKey(db, userId, keyId, { allowLastKey: true });
    await saveDb();
    await auditLog(session.userId, "reset_key", "user", userId, {
      action: "admin_revoke_user_api_key",
      targetUser: {
        id: userId,
        name: String(user[1] || ""),
        email: String(user[2] || ""),
        status: String(user[3] || ""),
      },
      keyId,
      maskedKey: result.revoked.maskedKey,
      remainingKeys: result.keys.length,
      reason,
    });

    return NextResponse.json({
      success: true,
      keys: result.keys,
      revoked: result.revoked,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to revoke API key";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
