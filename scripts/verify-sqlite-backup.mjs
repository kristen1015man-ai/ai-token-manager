import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const backupPath = process.argv[2];

if (!backupPath) {
  console.error("Usage: node scripts/verify-sqlite-backup.mjs <path-to-data.db-or-backup-dir>");
  process.exit(2);
}

const absPath = path.resolve(backupPath);
if (!fs.existsSync(absPath)) {
  console.error(`Backup file does not exist: ${absPath}`);
  process.exit(2);
}

const stat = fs.statSync(absPath);
if (!stat.isFile() && !stat.isDirectory()) {
  console.error(`Backup path is not a file or directory: ${absPath}`);
  process.exit(2);
}

const isBackupDirectory = stat.isDirectory();
const dataDbPath = isBackupDirectory ? path.join(absPath, "data.db") : absPath;

if (!fs.existsSync(dataDbPath) || !fs.statSync(dataDbPath).isFile()) {
  console.error(`Backup data.db does not exist: ${dataDbPath}`);
  process.exit(2);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function scalarNumber(db, sql, params = []) {
  const result = db.exec(sql, params);
  const value = result[0]?.values?.[0]?.[0];
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tableExists(db, tableName) {
  return scalarNumber(
    db,
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  ) > 0;
}

function countTable(db, tableName) {
  if (!tableExists(db, tableName)) return null;
  const safeName = `"${tableName.replace(/"/g, "\"\"")}"`;
  return scalarNumber(db, `SELECT COUNT(*) FROM ${safeName}`);
}

const requiredTables = [
  "users",
  "user_api_keys",
  "channels",
  "model_prices",
  "usage_logs",
  "quota_rules",
  "alert_logs",
];

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(dataDbPath));

function fileInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    return { present: false, path: filePath };
  }
  const fileStat = fs.statSync(filePath);
  if (!fileStat.isFile()) {
    return { present: false, path: filePath, error: "not a file" };
  }
  return {
    present: true,
    path: filePath,
    size: fileStat.size,
    sha256: sha256(filePath),
  };
}

function readManifest(backupDir) {
  if (!backupDir) return null;
  const manifestPath = path.join(backupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return { present: false, path: manifestPath };
  try {
    return {
      present: true,
      path: manifestPath,
      value: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    };
  } catch (error) {
    return {
      present: true,
      path: manifestPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function manifestMatchesBackupSet(manifest, backupSet) {
  if (!manifest?.present || manifest?.error || !manifest?.value || !backupSet) return false;
  const files = manifest.value.files || {};
  const dataDbOk = files.dataDb?.sha256 === backupSet.dataDb?.sha256 && files.dataDb?.size === backupSet.dataDb?.size;
  const usageQueueOk =
    files.usageQueue === null ||
    (files.usageQueue?.sha256 === backupSet.usageQueue?.sha256 && files.usageQueue?.size === backupSet.usageQueue?.size);
  const usageDeadLetterOk =
    files.usageDeadLetter === null ||
    (
      files.usageDeadLetter?.sha256 === backupSet.usageDeadLetter?.sha256 &&
      files.usageDeadLetter?.size === backupSet.usageDeadLetter?.size
    );
  return Boolean(dataDbOk && usageQueueOk && usageDeadLetterOk);
}

try {
  const integrity = db.exec("PRAGMA integrity_check")[0]?.values?.[0]?.[0];
  const tableRows = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  const tables = (tableRows[0]?.values ?? []).map((row) => String(row[0]));
  const missingTables = requiredTables.filter((table) => !tables.includes(table));

  const counts = Object.fromEntries(
    requiredTables.map((table) => [table, countTable(db, table)])
  );

  const dataDbStat = fs.statSync(dataDbPath);
  const manifest = readManifest(isBackupDirectory ? absPath : null);
  const backupSet = isBackupDirectory
    ? {
        dataDb: fileInfo(dataDbPath),
        manifest,
        usageQueue: fileInfo(path.join(absPath, "usage-queue.jsonl")),
        usageDeadLetter: fileInfo(path.join(absPath, "usage-dead-letter.jsonl")),
      }
    : null;
  const manifestOk = !isBackupDirectory || Boolean(manifest?.present && !manifest?.error);
  const backupSetOk = !isBackupDirectory || Boolean(
    backupSet?.dataDb?.present &&
      backupSet?.manifest?.present &&
      backupSet?.usageQueue?.present &&
      backupSet?.usageDeadLetter?.present
  );
  const manifestMatches = !isBackupDirectory || manifestMatchesBackupSet(manifest, backupSet);

  const result = {
    ok: integrity === "ok" && missingTables.length === 0 && manifestOk && backupSetOk && manifestMatches,
    path: dataDbPath,
    inputPath: absPath,
    inputType: isBackupDirectory ? "backup-directory" : "sqlite-file",
    size: dataDbStat.size,
    sha256: sha256(dataDbPath),
    integrity,
    tableCount: tables.length,
    missingTables,
    counts,
    backupSet,
    manifestMatches,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} finally {
  db.close();
}
