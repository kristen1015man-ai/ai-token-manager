import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../../../shared/schema";
import * as fs from "fs";
import * as path from "path";

// 优先用 DATABASE_URL，其次检测 Railway Volume，最后默认本地路径
const DB_PATH = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes(":")
  ? process.env.DATABASE_URL
  : process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/data.db`
    : "./data.db";

let dbInstance: ReturnType<typeof drizzle> | null = null;
let sqliteInstance: InstanceType<Awaited<ReturnType<typeof initSqlJs>>["Database"]> | null = null;

/**
 * sql.js 的 TS 类型定义未声明 exec()，但运行时确实存在。
 * 导出一个最小接口，供外部 helper 函数做参数类型。
 * 使用时：ensureBalanceColumns(sqlite as SqliteExec)
 */
export interface SqliteExec {
  exec(sql: string, params?: unknown[]): { columns: string[]; values: unknown[][] }[];
  run(sql: string, params?: unknown[]): void;
}

/**
 * 获取 sqlite 原生 exec/run 接口。
 * sql.js 的 TS 类型定义未声明 exec()，但运行时确实存在。
 * 统一通过此函数做类型转换，避免在各 API route 中重复 `as unknown as SqliteExec`。
 */
export function getRawExec(sqlite: InstanceType<Awaited<ReturnType<typeof initSqlJs>>["Database"]>): SqliteExec {
  return sqlite as unknown as SqliteExec;
}

// ========== 延迟批量写入（Debounce） ==========
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInProgress = false;
let needsReflush = false; // 保存期间有新写入，需要再刷一次
const DEBOUNCE_MS = 2_000; // 2秒内合并多次写入

function flushToDisk(): void {
  if (!sqliteInstance) return;
  if (saveInProgress) {
    // 保存进行中，标记需要再刷一次
    needsReflush = true;
    return;
  }
  saveInProgress = true;
  try {
    const absPath = path.resolve(DB_PATH);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, Buffer.from(sqliteInstance.export()));
  } finally {
    saveInProgress = false;
    // 如果保存期间有新数据写入，立即再刷一次
    if (needsReflush) {
      needsReflush = false;
      flushToDisk();
    }
  }
}

/**
 * 获取数据库实例（单例模式）
 */
export async function getDb() {
  if (dbInstance && sqliteInstance) {
    return { db: dbInstance, sqlite: sqliteInstance };
  }

  const absPath = path.resolve(DB_PATH);
  const SQL = await initSqlJs();

  let buffer: Buffer | undefined;
  if (fs.existsSync(absPath)) {
    buffer = fs.readFileSync(absPath);
  }

  const sqlite = buffer ? new SQL.Database(buffer) : new SQL.Database();

  // INTG-01: 启用外键约束（SQLite 默认关闭）
  sqlite.run("PRAGMA foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  dbInstance = db;
  sqliteInstance = sqlite;

  return { db, sqlite };
}

/**
 * 延迟保存数据库到文件（2秒 debounce）
 * 适用于高频写入场景（代理计费），多次写入合并为一次磁盘 I/O
 */
export function scheduleSave(): void {
  if (saveTimer) return; // 已有待执行的写入，跳过
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushToDisk();
  }, DEBOUNCE_MS);
}

/**
 * 立即保存数据库到文件（同步）
 * 适用于低频、关键写入（管理后台操作）
 */
export async function saveDb(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flushToDisk();
}

/**
 * 重置内存缓存，下次 getDb() 会从磁盘重新加载
 * 用于 seed/sync 等会 DROP+CREATE 表结构变化的操作后
 */
export function resetDb() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flushToDisk(); // 重置前先落盘
  dbInstance = null;
  sqliteInstance = null;
}
