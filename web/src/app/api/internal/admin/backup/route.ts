import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import initSqlJs from "sql.js";
import { NextRequest, NextResponse } from "next/server";
import { getDb, getDbPath, saveDb, type SqliteExec } from "../../../../../lib/db";
import { requireInternalRequest } from "../../../../../lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BackupFileInfo = {
  path: string;
  size: number;
  sha256: string;
};

type OptionalBackupFileInfo = BackupFileInfo & {
  copied: true;
};

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function volumeDirForDb(dbPath: string): string {
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH);
  }
  return path.dirname(dbPath);
}

function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fileInfo(filePath: string): BackupFileInfo {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    size: stat.size,
    sha256: hashFile(filePath),
  };
}

function copyRequiredFile(source: string, destination: string): BackupFileInfo {
  if (!fs.existsSync(source)) {
    throw new Error(`Required backup source is missing: ${source}`);
  }
  fs.copyFileSync(source, destination);
  return fileInfo(destination);
}

function copyOptionalFile(source: string, destination: string): OptionalBackupFileInfo | null {
  if (!fs.existsSync(source)) return null;
  fs.copyFileSync(source, destination);
  return {
    ...fileInfo(destination),
    copied: true,
  };
}

function scalarNumber(
  db: SqliteExec,
  sql: string,
  params: unknown[] = [],
): number {
  const result = db.exec(sql, params);
  const value = result[0]?.values?.[0]?.[0];
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tableExists(
  db: SqliteExec,
  tableName: string,
): boolean {
  return scalarNumber(
    db,
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  ) > 0;
}

function countTable(
  db: SqliteExec,
  tableName: string,
): number {
  const safeName = `"${tableName.replace(/"/g, "\"\"")}"`;
  return tableExists(db, tableName) ? scalarNumber(db, `SELECT COUNT(*) FROM ${safeName}`) : 0;
}

async function verifyDatabaseCopy(dbBackupPath: string) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbBackupPath)) as unknown as SqliteExec & { close: () => void };

  try {
    const integrity = db.exec("PRAGMA integrity_check")[0]?.values?.[0]?.[0];
    const tables = scalarNumber(db, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'");
    return {
      integrity,
      tables,
      users: countTable(db, "users"),
      userApiKeys: countTable(db, "user_api_keys"),
      channels: countTable(db, "channels"),
      modelPrices: countTable(db, "model_prices"),
      usageLogs: countTable(db, "usage_logs"),
      quotaReservations: countTable(db, "quota_reservations"),
      alertLogs: countTable(db, "alert_logs"),
    };
  } finally {
    db.close();
  }
}

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  await getDb();
  await saveDb();

  const dbPath = getDbPath();
  const volumeDir = volumeDirForDb(dbPath);
  const backupDir = path.join(volumeDir, "backups", `handoff-${timestampForPath()}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const queueFile = process.env.USAGE_QUEUE_FILE || path.join(volumeDir, "usage-queue.jsonl");
  const deadLetterFile = process.env.USAGE_DEAD_LETTER_FILE || path.join(volumeDir, "usage-dead-letter.jsonl");

  const dbBackupPath = path.join(backupDir, "data.db");
  const files = {
    dataDb: copyRequiredFile(dbPath, dbBackupPath),
    usageQueue: copyOptionalFile(queueFile, path.join(backupDir, "usage-queue.jsonl")),
    usageDeadLetter: copyOptionalFile(deadLetterFile, path.join(backupDir, "usage-dead-letter.jsonl")),
  };
  const verification = await verifyDatabaseCopy(dbBackupPath);

  if (verification.integrity !== "ok") {
    return NextResponse.json({
      success: false,
      error: "Backup copy failed SQLite integrity check",
      backupDir,
      verification,
    }, { status: 500 });
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    source: {
      dbPath,
      queueFile,
      deadLetterFile,
    },
    backupDir,
    files,
    verification,
  };
  const manifestPath = path.join(backupDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return NextResponse.json({
    success: true,
    backupDir,
    manifest: fileInfo(manifestPath),
    files,
    verification,
  });
}
