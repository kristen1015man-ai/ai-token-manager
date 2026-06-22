import * as fs from "fs";
import * as path from "path";
import { getDb, getDbPath, getRawExec } from "../../../lib/db";
import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { ensureDecrypted, isEncrypted } from "../../../lib/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REQUIRED_TABLES = ["users", "channels", "usage_logs", "quota_rules"];

interface SecretDecryptionCheck {
  ok: boolean;
  checked: number;
  failures: string[];
}

interface SecretStorageCheck {
  ok: boolean;
  checked: number;
  plaintext: string[];
}

interface WritablePathCheck {
  ok: boolean;
  path?: string;
  error?: string;
}

function hasInternalAuth(request: NextRequest): boolean {
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) return false;
  const expected = `Bearer ${internalKey}`;
  const provided = request.headers.get("authorization") || "";
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function checkEncryptedValue(label: string, value: unknown, result: SecretDecryptionCheck): void {
  if (typeof value !== "string" || !isEncrypted(value)) return;

  result.checked += 1;
  const decrypted = ensureDecrypted(value);
  if (!decrypted || decrypted === value || isEncrypted(decrypted)) {
    result.failures.push(label);
  }
}

function checkSecretDecryption(
  db: ReturnType<typeof getRawExec>,
  tableSet: Set<string>
): SecretDecryptionCheck {
  const result: SecretDecryptionCheck = { ok: true, checked: 0, failures: [] };
  const columnsFor = (table: string) => new Set(
    (db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => String(row[1]))
  );

  if (tableSet.has("channels")) {
    const cols = columnsFor("channels");
    const hasAccessKeySecret = cols.has("access_key_secret");
    const channelRows = db.exec(hasAccessKeySecret
      ? "SELECT id, api_key, access_key_secret FROM channels WHERE api_key LIKE 'enc:%' OR access_key_secret LIKE 'enc:%'"
      : "SELECT id, api_key, NULL FROM channels WHERE api_key LIKE 'enc:%'"
    );
    for (const row of channelRows[0]?.values ?? []) {
      const id = String(row[0] ?? "unknown");
      checkEncryptedValue(`channels.${id}.api_key`, row[1], result);
      checkEncryptedValue(`channels.${id}.access_key_secret`, row[2], result);
    }
  }

  if (tableSet.has("users")) {
    const userRows = db.exec("SELECT id, api_key FROM users WHERE api_key LIKE 'enc:%'");
    for (const row of userRows[0]?.values ?? []) {
      checkEncryptedValue(`users.${String(row[0] ?? "unknown")}.api_key`, row[1], result);
    }
  }

  if (tableSet.has("user_api_keys")) {
    const cols = columnsFor("user_api_keys");
    if (cols.has("key_encrypted")) {
      const keyRows = db.exec("SELECT id, key_encrypted FROM user_api_keys WHERE key_encrypted LIKE 'enc:%'");
      for (const row of keyRows[0]?.values ?? []) {
        checkEncryptedValue(`user_api_keys.${String(row[0] ?? "unknown")}.key_encrypted`, row[1], result);
      }
    }
  }

  result.ok = result.failures.length === 0;
  return result;
}

function checkPlaintextSecretStorage(
  db: ReturnType<typeof getRawExec>,
  tableSet: Set<string>
): SecretStorageCheck {
  const result: SecretStorageCheck = { ok: true, checked: 0, plaintext: [] };
  const columnsFor = (table: string) => new Set(
    (db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []).map((row) => String(row[1]))
  );

  const checkValue = (label: string, value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    result.checked += 1;
    if (!isEncrypted(trimmed)) {
      result.plaintext.push(label);
    }
  };

  if (tableSet.has("channels")) {
    const cols = columnsFor("channels");
    const hasAccessKeySecret = cols.has("access_key_secret");
    const channelRows = db.exec(hasAccessKeySecret
      ? "SELECT id, api_key, access_key_secret FROM channels WHERE COALESCE(api_key, '') != '' OR COALESCE(access_key_secret, '') != ''"
      : "SELECT id, api_key, NULL FROM channels WHERE COALESCE(api_key, '') != ''"
    );
    for (const row of channelRows[0]?.values ?? []) {
      const id = String(row[0] ?? "unknown");
      checkValue(`channels.${id}.api_key`, row[1]);
      checkValue(`channels.${id}.access_key_secret`, row[2]);
    }
  }

  if (tableSet.has("users")) {
    const userRows = db.exec("SELECT id, api_key FROM users WHERE COALESCE(api_key, '') != ''");
    for (const row of userRows[0]?.values ?? []) {
      checkValue(`users.${String(row[0] ?? "unknown")}.api_key`, row[1]);
    }
  }

  if (tableSet.has("user_api_keys")) {
    const cols = columnsFor("user_api_keys");
    if (cols.has("key_encrypted")) {
      const keyRows = db.exec("SELECT id, key_encrypted FROM user_api_keys WHERE COALESCE(key_encrypted, '') != ''");
      for (const row of keyRows[0]?.values ?? []) {
        checkValue(`user_api_keys.${String(row[0] ?? "unknown")}.key_encrypted`, row[1]);
      }
    }
  }

  result.ok = result.plaintext.length === 0;
  return result;
}

function checkDirectoryWritable(filePath: string | undefined, probeName: string): WritablePathCheck {
  if (!filePath) return { ok: true };

  const targetDir = path.dirname(path.resolve(filePath));
  const probePath = path.join(targetDir, probeName);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(probePath, String(Date.now()), "utf8");
    fs.unlinkSync(probePath);
    return { ok: true, path: targetDir };
  } catch (err) {
    return {
      ok: false,
      path: targetDir,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(request: NextRequest) {
  const detailed = hasInternalAuth(request);
  const checks: Record<string, unknown> = {
    jwtSecretConfigured: Boolean(process.env.JWT_SECRET),
    internalApiKeyConfigured: Boolean(process.env.INTERNAL_API_KEY),
    encryptionKeyConfigured: Boolean(process.env.ENCRYPTION_KEY),
    feishuConfigured: Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_REDIRECT_URI),
    autoSyncEnabled: process.env.AUTO_SYNC_ENABLED !== "false",
  };
  let ok = Boolean(
    process.env.JWT_SECRET &&
    process.env.INTERNAL_API_KEY &&
    process.env.ENCRYPTION_KEY &&
    process.env.FEISHU_APP_ID &&
    process.env.FEISHU_APP_SECRET &&
    process.env.FEISHU_REDIRECT_URI
  );

  try {
    const { sqlite } = await getDb();
    const db = getRawExec(sqlite);
    const rows = db.exec(`SELECT name FROM sqlite_master WHERE type='table'`);
    const tableSet = new Set((rows[0]?.values ?? []).map((r: unknown[]) => String(r[0])));
    const missingTables = REQUIRED_TABLES.filter((table) => !tableSet.has(table));
    checks.dbReadable = true;
    checks.missingTables = missingTables;
    if (missingTables.length > 0) ok = false;
    const secretDecryption = checkSecretDecryption(db, tableSet);
    checks.secretDecryption = detailed
      ? secretDecryption
      : { ok: secretDecryption.ok, checked: secretDecryption.checked };
    if (!secretDecryption.ok) ok = false;
    const secretStorage = checkPlaintextSecretStorage(db, tableSet);
    checks.secretStorage = detailed
      ? secretStorage
      : { ok: secretStorage.ok, checked: secretStorage.checked, plaintextCount: secretStorage.plaintext.length };
    if (!secretStorage.ok) ok = false;
    if (tableSet.has("users")) {
      const userRows = db.exec(`SELECT status, COUNT(*) FROM users GROUP BY status`);
      checks.users = Object.fromEntries(
        (userRows[0]?.values ?? []).map((r: unknown[]) => [String(r[0] || "unknown"), Number(r[1] || 0)])
      );
    }
    try {
      db.exec(`CREATE TEMP TABLE IF NOT EXISTS _health_write_check (id TEXT PRIMARY KEY, checked_at INTEGER)`);
      db.exec(`INSERT OR REPLACE INTO _health_write_check (id, checked_at) VALUES ('web', ?)`, [Math.floor(Date.now() / 1000)]);
      db.exec(`DELETE FROM _health_write_check WHERE id = 'web'`);
      checks.dbWritable = true;
    } catch (writeErr) {
      ok = false;
      checks.dbWritable = false;
      checks.dbWriteError = writeErr instanceof Error ? writeErr.message : "unknown";
    }
    const dbFileWritable = checkDirectoryWritable(getDbPath(), ".sparkloom-health-db-write-check");
    checks.dbFileWritable = detailed ? dbFileWritable : dbFileWritable.ok;
    if (!dbFileWritable.ok) ok = false;

    const queueWritable = checkDirectoryWritable(process.env.USAGE_QUEUE_FILE, ".sparkloom-health-queue-write-check");
    checks.usageQueueWritable = detailed ? queueWritable : queueWritable.ok;
    if (!queueWritable.ok) ok = false;

    const deadLetterWritable = checkDirectoryWritable(process.env.USAGE_DEAD_LETTER_FILE, ".sparkloom-health-dead-letter-write-check");
    checks.usageDeadLetterWritable = detailed ? deadLetterWritable : deadLetterWritable.ok;
    if (!deadLetterWritable.ok) ok = false;
  } catch (err) {
    ok = false;
    checks.dbReadable = false;
    checks.dbError = err instanceof Error ? err.message : "unknown";
  }

  return Response.json({
    status: ok ? "ok" : "degraded",
    service: "sparkloom-web",
    timestamp: new Date().toISOString(),
    ...(detailed ? {
      version: process.env.npm_package_version || "0.1.0",
      checks,
    } : {}),
  }, { status: ok ? 200 : 503 });
}
