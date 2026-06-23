import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import initSqlJs from "sql.js";
import { getDb, getDbPath, saveDb, type SqliteExec } from "./db";
import { uploadVerifiedBackupToObjectStorage } from "./object-storage-backup";

export type BackupFileInfo = {
  path: string;
  size: number;
  sha256: string;
};

export type OptionalBackupFileInfo = BackupFileInfo & {
  copied: boolean;
  sourceMissing?: true;
};

export type VerifiedBackupResult = {
  success: true;
  backupDir: string;
  manifest: BackupFileInfo;
  files: {
    dataDb: BackupFileInfo;
    usageQueue: OptionalBackupFileInfo;
    usageDeadLetter: OptionalBackupFileInfo;
  };
  verification: {
    integrity: unknown;
    tables: number;
    users: number;
    userApiKeys: number;
    channels: number;
    modelPrices: number;
    usageLogs: number;
    quotaRules: number;
    quotaReservations: number;
    alertLogs: number;
    alertSettings: number;
    adminLogs: number;
    syncBlacklist: number;
    systemFlags: number;
  };
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

function copyOptionalJsonlFile(source: string, destination: string): OptionalBackupFileInfo {
  if (!fs.existsSync(source)) {
    fs.writeFileSync(destination, "", "utf8");
    return {
      ...fileInfo(destination),
      copied: false,
      sourceMissing: true,
    };
  }
  fs.copyFileSync(source, destination);
  return {
    ...fileInfo(destination),
    copied: true,
  };
}

function scalarNumber(db: SqliteExec, sql: string, params: unknown[] = []): number {
  const result = db.exec(sql, params);
  const value = result[0]?.values?.[0]?.[0];
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tableExists(db: SqliteExec, tableName: string): boolean {
  return scalarNumber(
    db,
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  ) > 0;
}

function countTable(db: SqliteExec, tableName: string): number {
  const safeName = `"${tableName.replace(/"/g, "\"\"")}"`;
  return tableExists(db, tableName) ? scalarNumber(db, `SELECT COUNT(*) FROM ${safeName}`) : 0;
}

async function verifyDatabaseCopy(dbBackupPath: string): Promise<VerifiedBackupResult["verification"]> {
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
      quotaRules: countTable(db, "quota_rules"),
      quotaReservations: countTable(db, "quota_reservations"),
      alertLogs: countTable(db, "alert_logs"),
      alertSettings: countTable(db, "alert_settings"),
      adminLogs: countTable(db, "admin_logs"),
      syncBlacklist: countTable(db, "sync_blacklist"),
      systemFlags: countTable(db, "system_flags"),
    };
  } finally {
    db.close();
  }
}

function summarizeForLogs(result: VerifiedBackupResult) {
  return {
    success: result.success,
    backupDir: result.backupDir,
    manifestSha256: result.manifest.sha256,
    dataDbSha256: result.files.dataDb.sha256,
    dataDbSize: result.files.dataDb.size,
    usageQueueCopied: Boolean(result.files.usageQueue),
    usageDeadLetterCopied: Boolean(result.files.usageDeadLetter),
    verification: result.verification,
  };
}

function safeMarkerId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) || "default";
}

export async function createVerifiedBackup(reason = "manual"): Promise<VerifiedBackupResult> {
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
    usageQueue: copyOptionalJsonlFile(queueFile, path.join(backupDir, "usage-queue.jsonl")),
    usageDeadLetter: copyOptionalJsonlFile(deadLetterFile, path.join(backupDir, "usage-dead-letter.jsonl")),
  };
  const verification = await verifyDatabaseCopy(dbBackupPath);

  if (verification.integrity !== "ok") {
    throw new Error(`Backup copy failed SQLite integrity check: ${String(verification.integrity)}`);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    reason,
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

  return {
    success: true,
    backupDir,
    manifest: fileInfo(manifestPath),
    files,
    verification,
  };
}

export async function runStartupBackupDrillIfEnabled(): Promise<void> {
  if (process.env.RUN_BACKUP_DRILL_ON_START !== "true") return;

  const dbPath = getDbPath();
  const volumeDir = volumeDirForDb(dbPath);
  const markerId = safeMarkerId(
    process.env.BACKUP_DRILL_RUN_ID ||
    process.env.RAILWAY_DEPLOYMENT_ID ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    "default",
  );
  const markerPath = path.join(volumeDir, `.sparkloom-backup-drill-${markerId}.json`);

  if (fs.existsSync(markerPath)) {
    const marker = fs.readFileSync(markerPath, "utf8");
    console.log(`[BackupDrill] already completed ${marker}`);
    return;
  }

  const result = await createVerifiedBackup("startup-drill");
  const objectStorage = await uploadVerifiedBackupToObjectStorage(result);
  const summary = summarizeForLogs(result);
  fs.writeFileSync(markerPath, `${JSON.stringify({
    completedAt: new Date().toISOString(),
    ...summary,
    objectStorage,
  })}\n`, "utf8");
  console.log(`[BackupDrill] completed ${JSON.stringify({ ...summary, objectStorage })}`);
}
