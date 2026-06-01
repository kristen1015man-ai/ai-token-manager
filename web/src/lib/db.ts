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
  const db = drizzle(sqlite, { schema });

  dbInstance = db;
  sqliteInstance = sqlite;

  return { db, sqlite };
}

/**
 * 保存数据库到文件
 */
export async function saveDb() {
  if (!sqliteInstance) return;
  const absPath = path.resolve(DB_PATH);
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(absPath, Buffer.from(sqliteInstance.export()));
}
