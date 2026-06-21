import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { users } from "../../../../../../../shared/schema";
import { getDb, getRawExec, scheduleSave } from "../../../../../lib/db";
import { ensureDecrypted, safeEqual, searchableHash, searchableHashes } from "../../../../../lib/crypto";
import { requireInternalRequest } from "../../../../../lib/internal-auth";
import { findStoredApiKeyByHashes, markUserApiKeyUsed } from "../../../../../lib/user-api-keys";

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  let body: { apiKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey.startsWith("sk-emp-")) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const { db, sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  const primaryHash = searchableHash(apiKey);
  const hashes = searchableHashes(apiKey);

  const storedKey = findStoredApiKeyByHashes(raw, hashes);
  if (storedKey) {
    const decryptedStoredKey = ensureDecrypted(storedKey.keyEncrypted);
    if (!safeEqual(decryptedStoredKey, apiKey)) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const ownerRows = await db.select().from(users).where(eq(users.id, storedKey.userId)).limit(1);
    const owner = ownerRows[0];
    if (!owner || owner.status === "disabled") {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    if (storedKey.keyHash !== primaryHash) {
      try {
        raw.run("UPDATE user_api_keys SET key_hash = ? WHERE id = ?", [primaryHash, storedKey.id]);
        raw.run("UPDATE users SET api_key_hash = ? WHERE id = ? AND api_key_hash = ?", [
          primaryHash,
          storedKey.userId,
          storedKey.keyHash,
        ]);
      } catch (error) {
        console.error("[auth] failed to upgrade API key hash:", error);
      }
    }

    markUserApiKeyUsed(raw, storedKey.id);
    scheduleSave();

    return NextResponse.json({
      user: {
        id: owner.id,
        name: owner.name,
        role: owner.role,
        departmentId: owner.departmentId,
        department: owner.department,
        monthlyQuota: owner.monthlyQuota ?? 0,
      },
    });
  }

  return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
}
