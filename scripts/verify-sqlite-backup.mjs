import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const backupPath = process.argv[2];

if (!backupPath) {
  console.error("Usage: node scripts/verify-sqlite-backup.mjs <path-to-data.db>");
  process.exit(2);
}

const absPath = path.resolve(backupPath);
if (!fs.existsSync(absPath)) {
  console.error(`Backup file does not exist: ${absPath}`);
  process.exit(2);
}

const stat = fs.statSync(absPath);
if (!stat.isFile()) {
  console.error(`Backup path is not a file: ${absPath}`);
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
const db = new SQL.Database(fs.readFileSync(absPath));

try {
  const integrity = db.exec("PRAGMA integrity_check")[0]?.values?.[0]?.[0];
  const tableRows = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  const tables = (tableRows[0]?.values ?? []).map((row) => String(row[0]));
  const missingTables = requiredTables.filter((table) => !tables.includes(table));

  const counts = Object.fromEntries(
    requiredTables.map((table) => [table, countTable(db, table)])
  );

  const result = {
    ok: integrity === "ok" && missingTables.length === 0,
    path: absPath,
    size: stat.size,
    sha256: sha256(absPath),
    integrity,
    tableCount: tables.length,
    missingTables,
    counts,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} finally {
  db.close();
}
