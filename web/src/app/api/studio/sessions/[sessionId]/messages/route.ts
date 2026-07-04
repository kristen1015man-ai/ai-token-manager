import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../../../lib/admin-check";
import { getDb, getRawExec, saveDb } from "../../../../../../lib/db";
import { ensureStudioTables } from "../../../../../../lib/studio-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function cleanContent(value: unknown): string {
  const content = typeof value === "string" ? value.trim() : "";
  return content.slice(0, 20_000);
}

function cleanRole(value: unknown): "user" | "assistant" {
  return value === "assistant" ? "assistant" : "user";
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const content = cleanContent(body.content);
  if (!content) {
    return NextResponse.json({ error: "Message content is required" }, { status: 400 });
  }

  const role = cleanRole(body.role);
  const now = Math.floor(Date.now() / 1000);
  const id = randomUUID();

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const sessionRows = raw.exec(
    "SELECT id FROM studio_sessions WHERE id = ? AND user_id = ? LIMIT 1",
    [sessionId, session.userId]
  )[0]?.values ?? [];
  if (!sessionRows[0]) {
    return NextResponse.json({ error: "Studio session not found" }, { status: 404 });
  }

  raw.run(
    `INSERT INTO studio_messages (id, session_id, user_id, role, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sessionId,
      session.userId,
      role,
      content,
      JSON.stringify({ source: "studio" }),
      now,
    ]
  );
  raw.run("UPDATE studio_sessions SET updated_at = ? WHERE id = ? AND user_id = ?", [
    now,
    sessionId,
    session.userId,
  ]);
  await saveDb();

  return NextResponse.json(
    {
      message: {
        id,
        role,
        content,
        metadata: { source: "studio" },
        createdAt: now,
      },
    },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const url = new URL(request.url);
  const fromMsgId = url.searchParams.get("from");

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  if (fromMsgId) {
    const rows = raw.exec(
      "SELECT rowid FROM studio_messages WHERE id = ? AND session_id = ? AND user_id = ? LIMIT 1",
      [fromMsgId, sessionId, session.userId]
    )[0]?.values ?? [];
    if (!rows[0]) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    // M15：用 rowid 边界替代 created_at。studio_messages 表内 rowid 单调递增、与插入顺序一致，
    // 而整数秒时间戳在「用户发消息 + agent 立即报错回写」或「连续两次发送」场景下会碰撞。
    // 改前：created_at >= fromCreatedAt 会把同秒内早于目标的消息也删掉（数据丢失）。
    // 改后：rowid >= fromRowid 仅删目标消息及其后插入的消息，精确无歧义。
    const fromRowid = Number(rows[0][0]);
    raw.run(
      "DELETE FROM studio_messages WHERE session_id = ? AND user_id = ? AND rowid >= ?",
      [sessionId, session.userId, fromRowid]
    );
  } else {
    raw.run(
      "DELETE FROM studio_messages WHERE session_id = ? AND user_id = ?",
      [sessionId, session.userId]
    );
  }
  await saveDb();

  return NextResponse.json({ ok: true });
}
