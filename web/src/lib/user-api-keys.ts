import { randomBytes } from "crypto";
import { ensureDecrypted, ensureEncrypted, searchableHash } from "./crypto";
import { type SqliteExec } from "./db";

export interface UserApiKeyListItem {
  id: string;
  maskedKey: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface StoredUserApiKey {
  id: string;
  userId: string;
  keyHash: string;
  keyEncrypted: string;
  maskedKey: string;
  name: string;
  createdAt: number;
}

export function maskEmployeeApiKey(apiKey: string): string {
  if (!apiKey) return "";
  const lastDash = apiKey.lastIndexOf("-");
  const prefix = lastDash > 0 ? apiKey.slice(0, Math.min(lastDash + 1, 32)) : apiKey.slice(0, 12);
  return `${prefix}****${apiKey.slice(-4)}`;
}

export function ensureUserApiKeysTable(db: SqliteExec): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS user_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_encrypted TEXT NOT NULL,
      masked_key TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'API Key',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_user_api_keys_hash ON user_api_keys(key_hash)");
}

export function backfillUserApiKeys(db: SqliteExec, userId?: string): number {
  ensureUserApiKeysTable(db);

  const params = userId ? [userId] : [];
  const conditions = [
    "NOT EXISTS (SELECT 1 FROM user_api_keys k WHERE k.user_id = u.id)",
  ];
  if (userId) conditions.unshift("u.id = ?");
  const where = `WHERE ${conditions.join(" AND ")}`;
  const rows = db.exec(
    `SELECT u.id, u.api_key, u.api_key_hash, COALESCE(u.created_at, unixepoch())
     FROM users u
     ${where}`,
    params
  );

  let inserted = 0;
  for (const row of rows[0]?.values || []) {
    const rowUserId = String(row[0]);
    const encryptedValue = String(row[1] || "");
    const existingHash = String(row[2] || "");
    const createdAt = Number(row[3] || Math.floor(Date.now() / 1000));
    const plainKey = ensureDecrypted(encryptedValue);
    if (!plainKey || !plainKey.startsWith("sk-emp-")) continue;

    const keyHash = existingHash || searchableHash(plainKey);
    const keyEncrypted = encryptedValue.startsWith("enc:v1:") ? encryptedValue : ensureEncrypted(plainKey);
    db.run(
      `INSERT OR IGNORE INTO user_api_keys
        (id, user_id, key_hash, key_encrypted, masked_key, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `key_${randomBytes(8).toString("hex")}`,
        rowUserId,
        keyHash,
        keyEncrypted,
        maskEmployeeApiKey(plainKey),
        "Default key",
        createdAt,
      ]
    );
    if (!existingHash) {
      db.run("UPDATE users SET api_key_hash = ? WHERE id = ?", [keyHash, rowUserId]);
    }
    inserted++;
  }
  return inserted;
}

export function removeBackfilledDefaultApiKeys(db: SqliteExec): number {
  ensureUserApiKeysTable(db);
  const before = db.exec("SELECT COUNT(*) FROM user_api_keys WHERE name = 'Default key'");
  const count = Number(before[0]?.values?.[0]?.[0] ?? 0);
  if (count > 0) {
    db.run("DELETE FROM user_api_keys WHERE name = 'Default key'");
  }
  return count;
}

export function listUserApiKeys(db: SqliteExec, userId: string): UserApiKeyListItem[] {
  ensureUserApiKeysTable(db);
  const result = db.exec(
    `SELECT id, masked_key, name, created_at, last_used_at
     FROM user_api_keys
     WHERE user_id = ?
     ORDER BY created_at ASC`,
    [userId]
  );
  return (result[0]?.values || []).map((row) => ({
    id: String(row[0]),
    maskedKey: String(row[1] || ""),
    name: String(row[2] || "API Key"),
    createdAt: Number(row[3] || 0),
    lastUsedAt: row[4] === null || row[4] === undefined ? null : Number(row[4]),
  }));
}

export function insertUserApiKey(db: SqliteExec, userId: string, apiKey: string, name = "API Key"): UserApiKeyListItem {
  ensureUserApiKeysTable(db);
  const now = Math.floor(Date.now() / 1000);
  const keyHash = searchableHash(apiKey);
  const keyEncrypted = ensureEncrypted(apiKey);
  const item = {
    id: `key_${randomBytes(8).toString("hex")}`,
    maskedKey: maskEmployeeApiKey(apiKey),
    name,
    createdAt: now,
    lastUsedAt: null,
  };

  db.run(
    `INSERT INTO user_api_keys
      (id, user_id, key_hash, key_encrypted, masked_key, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [item.id, userId, keyHash, keyEncrypted, item.maskedKey, name, now]
  );
  db.run(
    "UPDATE users SET api_key = ?, api_key_hash = ?, updated_at = ? WHERE id = ?",
    [keyEncrypted, keyHash, now, userId]
  );
  return item;
}

export function deleteUserApiKey(db: SqliteExec, userId: string, keyId: string): UserApiKeyListItem[] {
  ensureUserApiKeysTable(db);

  const existing = db.exec(
    "SELECT id, key_hash FROM user_api_keys WHERE user_id = ? ORDER BY created_at ASC",
    [userId]
  );
  const rows = existing[0]?.values || [];
  if (rows.length <= 1) {
    throw new Error("At least one API key must remain");
  }

  const target = rows.find((row) => String(row[0]) === keyId);
  if (!target) {
    throw new Error("API key not found");
  }
  const targetHash = String(target[1] || "");

  db.run("DELETE FROM user_api_keys WHERE user_id = ? AND id = ?", [userId, keyId]);

  const userHashResult = db.exec("SELECT api_key_hash FROM users WHERE id = ?", [userId]);
  const currentUserHash = String(userHashResult[0]?.values?.[0]?.[0] || "");
  if (currentUserHash === targetHash) {
    const replacement = db.exec(
      `SELECT key_encrypted, key_hash
       FROM user_api_keys
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    const replacementRow = replacement[0]?.values?.[0];
    if (replacementRow) {
      db.run(
        "UPDATE users SET api_key = ?, api_key_hash = ?, updated_at = ? WHERE id = ?",
        [String(replacementRow[0]), String(replacementRow[1]), Math.floor(Date.now() / 1000), userId]
      );
    }
  }

  return listUserApiKeys(db, userId);
}

export function adminRevokeUserApiKey(
  db: SqliteExec,
  userId: string,
  keyId: string,
  options: { allowLastKey?: boolean } = {}
): { keys: UserApiKeyListItem[]; revoked: UserApiKeyListItem } {
  ensureUserApiKeysTable(db);

  const existing = db.exec(
    `SELECT id, key_hash, masked_key, name, created_at, last_used_at
     FROM user_api_keys
     WHERE user_id = ?
     ORDER BY created_at ASC`,
    [userId]
  );
  const rows = existing[0]?.values || [];
  if (rows.length === 0) {
    throw new Error("API key not found");
  }
  if (rows.length <= 1 && options.allowLastKey !== true) {
    throw new Error("At least one API key must remain");
  }

  const target = rows.find((row) => String(row[0]) === keyId);
  if (!target) {
    throw new Error("API key not found");
  }

  const revoked: UserApiKeyListItem = {
    id: String(target[0]),
    maskedKey: String(target[2] || ""),
    name: String(target[3] || "API Key"),
    createdAt: Number(target[4] || 0),
    lastUsedAt: target[5] === null || target[5] === undefined ? null : Number(target[5]),
  };
  const targetHash = String(target[1] || "");
  const now = Math.floor(Date.now() / 1000);

  db.run("DELETE FROM user_api_keys WHERE user_id = ? AND id = ?", [userId, keyId]);

  const replacement = db.exec(
    `SELECT key_encrypted, key_hash
     FROM user_api_keys
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  const replacementRow = replacement[0]?.values?.[0];
  const userHashResult = db.exec("SELECT api_key_hash FROM users WHERE id = ?", [userId]);
  const currentUserHash = String(userHashResult[0]?.values?.[0]?.[0] || "");

  if (replacementRow) {
    if (currentUserHash === targetHash) {
      db.run(
        "UPDATE users SET api_key = ?, api_key_hash = ?, updated_at = ? WHERE id = ?",
        [String(replacementRow[0]), String(replacementRow[1]), now, userId]
      );
    }
  } else {
    const revokedSentinel = `revoked-${randomBytes(16).toString("hex")}`;
    db.run(
      "UPDATE users SET api_key = ?, api_key_hash = ?, updated_at = ? WHERE id = ?",
      [ensureEncrypted(revokedSentinel), searchableHash(revokedSentinel), now, userId]
    );
  }

  return { keys: listUserApiKeys(db, userId), revoked };
}

export function findStoredApiKeyByHash(db: SqliteExec, keyHash: string): StoredUserApiKey | null {
  ensureUserApiKeysTable(db);
  const result = db.exec(
    `SELECT id, user_id, key_hash, key_encrypted, masked_key, name, created_at
     FROM user_api_keys
     WHERE key_hash = ?
     LIMIT 1`,
    [keyHash]
  );
  const row = result[0]?.values?.[0];
  if (!row) return null;
  return {
    id: String(row[0]),
    userId: String(row[1]),
    keyHash: String(row[2]),
    keyEncrypted: String(row[3]),
    maskedKey: String(row[4]),
    name: String(row[5] || "API Key"),
    createdAt: Number(row[6] || 0),
  };
}

export function markUserApiKeyUsed(db: SqliteExec, keyId: string, now = Math.floor(Date.now() / 1000)): void {
  ensureUserApiKeysTable(db);
  db.run("UPDATE user_api_keys SET last_used_at = ? WHERE id = ?", [now, keyId]);
}
