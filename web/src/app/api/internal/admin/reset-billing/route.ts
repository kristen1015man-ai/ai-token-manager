import * as fs from "fs";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getDb, getRawExec, saveDb, type SqliteExec } from "../../../../../lib/db";
import { requireInternalRequest } from "../../../../../lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESET_CONFIRM_HEADER = "x-sparkloom-maintenance-confirm";
const RESET_CONFIRM_VALUE = "reset-billing-usage";

function resolveDbPath(): string {
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes(":")) {
    return path.resolve(process.env.DATABASE_URL);
  }

  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, "data.db");
  }

  return path.resolve("./data.db");
}

function numberScalar(db: SqliteExec, sql: string, params: unknown[] = []): number {
  const result = db.exec(sql, params);
  const value = result[0]?.values?.[0]?.[0];
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tableExists(db: SqliteExec, tableName: string): boolean {
  return numberScalar(
    db,
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  ) > 0;
}

function backupDbFile(dbPath: string): string | null {
  if (!fs.existsSync(dbPath)) return null;

  const backupDir = path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `data-before-billing-reset-${timestamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function removeIfExists(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

function cleanupProxyUsageQueue(dbPath: string) {
  const volumeDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.dirname(dbPath);
  const queueFile = process.env.USAGE_QUEUE_FILE || path.join(volumeDir, "usage-queue.jsonl");
  const deadLetterFile = process.env.USAGE_DEAD_LETTER_FILE || path.join(volumeDir, "usage-dead-letter.jsonl");

  return {
    queueFileRemoved: removeIfExists(queueFile),
    deadLetterFileRemoved: removeIfExists(deadLetterFile),
  };
}

async function clearProxyMemoryQueue(): Promise<{ ok: boolean; detail: unknown }> {
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) return { ok: false, detail: "INTERNAL_API_KEY missing" };

  const proxyUrl = (process.env.PROXY_INTERNAL_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
  try {
    const resp = await fetch(`${proxyUrl}/internal/admin/usage-queue/clear`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${internalKey}`,
        [RESET_CONFIRM_HEADER]: RESET_CONFIRM_VALUE,
      },
      signal: AbortSignal.timeout(5000),
    });
    const text = await resp.text();
    let detail: unknown = text;
    try {
      detail = text ? JSON.parse(text) : null;
    } catch {}
    return { ok: resp.ok, detail };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;
  if (process.env.ENABLE_INTERNAL_BILLING_RESET !== "true") {
    return NextResponse.json({
      error: "Billing reset is disabled. Set ENABLE_INTERNAL_BILLING_RESET=true only during an approved maintenance window.",
    }, { status: 403 });
  }
  if (request.headers.get(RESET_CONFIRM_HEADER) !== RESET_CONFIRM_VALUE) {
    return NextResponse.json({
      error: `Missing ${RESET_CONFIRM_HEADER}: ${RESET_CONFIRM_VALUE}`,
    }, { status: 400 });
  }

  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);

  await saveDb();
  const dbPath = resolveDbPath();
  const backupPath = backupDbFile(dbPath);
  const proxyMemoryQueue = await clearProxyMemoryQueue();
  if (!proxyMemoryQueue.ok) {
    return NextResponse.json({
      error: "Failed to clear proxy in-memory usage queue; billing reset aborted",
      backupPath,
      proxyMemoryQueue,
    }, { status: 502 });
  }

  const hasUsageLogs = tableExists(db, "usage_logs");
  const hasQuotaReservations = tableExists(db, "quota_reservations");
  const before = {
    usageLogs: hasUsageLogs ? numberScalar(db, "SELECT COUNT(*) FROM usage_logs") : 0,
    quotaReservations: hasQuotaReservations ? numberScalar(db, "SELECT COUNT(*) FROM quota_reservations") : 0,
    totalCost: hasUsageLogs ? numberScalar(db, "SELECT COALESCE(SUM(cost), 0) FROM usage_logs") : 0,
    totalTokens: hasUsageLogs ? numberScalar(db, "SELECT COALESCE(SUM(total_tokens), 0) FROM usage_logs") : 0,
  };

  db.run("BEGIN IMMEDIATE");
  try {
    if (hasQuotaReservations) {
      db.run("DELETE FROM quota_reservations");
    }
    if (hasUsageLogs) {
      db.run("DELETE FROM usage_logs");
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  await saveDb();
  const proxyQueue = cleanupProxyUsageQueue(dbPath);

  return NextResponse.json({
    success: true,
    resetAt: new Date().toISOString(),
    backupPath,
    before,
    cleared: {
      usageLogs: before.usageLogs,
      quotaReservations: before.quotaReservations,
      proxyMemoryQueue,
      proxyQueue,
    },
  });
}
