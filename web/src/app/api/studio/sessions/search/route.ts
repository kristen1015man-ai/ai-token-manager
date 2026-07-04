import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../../lib/admin-check";
import { getDb, getRawExec } from "../../../../../lib/db";
import { ensureStudioTables } from "../../../../../lib/studio-db";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;

function clampLimit(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// 全文搜索会话：匹配 studio_sessions.title 或 studio_messages.content
// LIKE 实现，避免依赖 FTS5（部分 sql.js 编译选项未启用 FTS）
export async function GET(request: NextRequest) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ query: "", sessions: [] });
  }
  const limit = clampLimit(request.nextUrl.searchParams.get("limit"));
  // 转义 LIKE 通配符，避免用户输入 %/_ 干扰匹配范围
  const escaped = q.replace(/[%_\\]/g, "\\$&");
  const pattern = `%${escaped}%`;

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const rows = raw.exec(
    `SELECT DISTINCT s.id, s.title, s.default_model, s.mode, s.created_at, s.updated_at
     FROM studio_sessions s
     LEFT JOIN studio_messages m ON m.session_id = s.id AND m.user_id = s.user_id
     WHERE s.user_id = ?
       AND (s.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')
     ORDER BY s.updated_at DESC
     LIMIT ?`,
    [session.userId, pattern, pattern, limit]
  )[0]?.values ?? [];

  return NextResponse.json({
    query: q,
    sessions: rows.map((row) => ({
      id: String(row[0]),
      title: String(row[1] ?? "New Studio Session"),
      defaultModel: row[2] ? String(row[2]) : null,
      mode: String(row[3] ?? "default"),
      createdAt: Number(row[4] ?? 0),
      updatedAt: Number(row[5] ?? 0),
    })),
  });
}
