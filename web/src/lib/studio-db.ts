import type { SqliteExec } from "./db";

export function ensureStudioTables(db: SqliteExec): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS studio_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Studio Session',
      default_model TEXT,
      mode TEXT NOT NULL DEFAULT 'default',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS studio_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS studio_agent_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      platform TEXT,
      agent_version TEXT,
      public_key TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      paired_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS studio_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT,
      name TEXT NOT NULL,
      root_hash TEXT NOT NULL,
      last_opened_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (device_id) REFERENCES studio_agent_devices(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS studio_commands (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      user_id TEXT NOT NULL,
      device_id TEXT,
      project_id TEXT,
      mode TEXT NOT NULL DEFAULT 'default',
      command_summary TEXT NOT NULL,
      command_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_confirmation',
      risk_level TEXT NOT NULL DEFAULT 'medium',
      exit_code INTEGER,
      output_hash TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES studio_sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (device_id) REFERENCES studio_agent_devices(id),
      FOREIGN KEY (project_id) REFERENCES studio_projects(id)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_studio_sessions_user_updated ON studio_sessions(user_id, updated_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_studio_messages_session_created ON studio_messages(session_id, created_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_studio_devices_user_status ON studio_agent_devices(user_id, status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_studio_commands_user_created ON studio_commands(user_id, created_at)");

  // F per-session：每会话独立 cwd，新增 project_path 列（幂等迁移）
  ensureColumn(db, "studio_sessions", "project_path", "TEXT");

  // J-2 审批密钥审计日志：记录每次 approve/deny 决策与工具/输入摘要
  db.run(`
    CREATE TABLE IF NOT EXISTS studio_approval_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      approval_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      tool_name TEXT,
      risk TEXT,
      input_summary TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_studio_approval_logs_user_created ON studio_approval_logs(user_id, created_at)");
}

function ensureColumn(db: SqliteExec, table: string, column: string, type: string): void {
  const rows = db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? [];
  const exists = rows.some((row) => String(row[1] ?? "") === column);
  if (!exists) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
