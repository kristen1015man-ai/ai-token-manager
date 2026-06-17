import { getDb, getRawExec } from "../../../lib/db";
import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

const REQUIRED_TABLES = ["users", "channels", "usage_logs", "quota_rules"];

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
