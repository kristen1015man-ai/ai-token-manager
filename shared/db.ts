import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "./schema.js";
import * as fs from "fs";
import * as path from "path";

let sqlJsInstance: SqlJsDatabase | null = null;

export async function createDb(dbPath: string) {
  // 如果已有实例且文件路径相同，直接复用
  const absPath = path.resolve(dbPath);

  const SQL = await initSqlJs();

  let buffer: Buffer | undefined;
  if (fs.existsSync(absPath)) {
    buffer = fs.readFileSync(absPath);
  }

  const sqlite = buffer ? new SQL.Database(buffer) : new SQL.Database();

  // 保存到文件的函数
  const save = () => {
    const data = sqlite.export();
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, Buffer.from(data));
  };

  const db = drizzle(sqlite, { schema });

  // 返回 db 实例 + 保存函数
  return { db, save, sqlite };
}

export type Database = Awaited<ReturnType<typeof createDb>>["db"];
