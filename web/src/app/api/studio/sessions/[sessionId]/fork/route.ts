import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../../../lib/admin-check";
import { getDb, getRawExec, saveDb } from "../../../../../../lib/db";
import { ensureStudioTables } from "../../../../../../lib/studio-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

// P2-1 分支对话：复制 session + messages 到新 session_id
// 不复制 claude session 映射（由前端 localStorage 持有，且 Claude SDK 不能跨 session 复制状态）
// 可选 body.beforeMessageId：只复制该消息（含）之前的；缺省复制全部
export async function POST(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const beforeMessageId = typeof body.beforeMessageId === "string" ? body.beforeMessageId : null;
  const titleSuffix = typeof body.titleSuffix === "string" && body.titleSuffix.trim()
    ? body.titleSuffix.trim().slice(0, 20)
    : "[fork]";

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const sessionRows = raw.exec(
    `SELECT id, title, default_model, mode, created_at, updated_at, project_path
     FROM studio_sessions
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [sessionId, session.userId]
  )[0]?.values ?? [];
  if (!sessionRows[0]) {
    return NextResponse.json({ error: "Studio session not found" }, { status: 404 });
  }
  const srcTitle = String(sessionRows[0][1] ?? "New Studio Session");
  const srcModel = sessionRows[0][2] ? String(sessionRows[0][2]) : null;
  const srcMode = String(sessionRows[0][3] ?? "default");
  const srcProject = sessionRows[0][6] ? String(sessionRows[0][6]) : null;

  // 决定截断点（如指定 beforeMessageId）
  // M16：用 rowid 边界替代 created_at。studio_messages 表内 rowid 单调递增、与插入顺序一致，
  // 整数秒时间戳在并发回写/连续发送时碰撞，会导致 fork 多带本应被截断的后续消息。
  let beforeRowid: number | null = null;
  if (beforeMessageId) {
    const rows = raw.exec(
      "SELECT rowid FROM studio_messages WHERE id = ? AND session_id = ? AND user_id = ? LIMIT 1",
      [beforeMessageId, sessionId, session.userId]
    )[0]?.values ?? [];
    if (!rows[0]) {
      return NextResponse.json({ error: "beforeMessageId not found in this session" }, { status: 404 });
    }
    beforeRowid = Number(rows[0][0]);
  }

  // 拉取待复制的消息（按 rowid 顺序，等价于插入顺序；rowid 边界消除整数秒碰撞歧义）
  const msgRows = beforeRowid === null
    ? raw.exec(
        "SELECT role, content, metadata, created_at FROM studio_messages WHERE session_id = ? AND user_id = ? ORDER BY rowid ASC",
        [sessionId, session.userId]
      )[0]?.values ?? []
    : raw.exec(
        "SELECT role, content, metadata, created_at FROM studio_messages WHERE session_id = ? AND user_id = ? AND rowid <= ? ORDER BY rowid ASC",
        [sessionId, session.userId, beforeRowid]
      )[0]?.values ?? [];

  // 创建新 session（不级联 claude 映射，强制开新 claude session）
  const newSessionId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  // 标题：原标题去尾部已有的 [fork] 标记后再追加，避免重复嵌套
  const cleanSrc = srcTitle.replace(/\s*\[fork\]\s*$/i, "").trim();
  const newTitle = `${cleanSrc} ${titleSuffix}`.slice(0, 80);

  // L7：session + messages 批写用显式事务包裹，任一 INSERT 失败即 ROLLBACK，
  // 避免中途失败留"session 已建但只复制了部分消息"的脏状态被 saveDb 落盘。
  raw.run("BEGIN");
  try {
    raw.run(
      `INSERT INTO studio_sessions (id, user_id, title, default_model, mode, created_at, updated_at, project_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newSessionId, session.userId, newTitle, srcModel, srcMode, now, now, srcProject]
    );

    // 批量复制消息（保持原 createdAt 顺序，便于历史回放）
    for (const row of msgRows) {
      const id = randomUUID();
      raw.run(
        `INSERT INTO studio_messages (id, session_id, user_id, role, content, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          newSessionId,
          session.userId,
          String(row[0]),
          String(row[1] ?? ""),
          row[2] ? String(row[2]) : JSON.stringify({ source: "studio-fork" }),
          Number(row[3] ?? now),
        ]
      );
    }
    raw.run("COMMIT");
  } catch (e) {
    try { raw.run("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
  await saveDb();

  return NextResponse.json(
    {
      session: {
        id: newSessionId,
        title: newTitle,
        defaultModel: srcModel,
        mode: srcMode,
        createdAt: now,
        updatedAt: now,
        projectPath: srcProject,
      },
      forkedFrom: sessionId,
      messageCount: msgRows.length,
    },
    { status: 201 }
  );
}
