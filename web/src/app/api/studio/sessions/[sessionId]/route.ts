import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../../lib/admin-check";
import { getDb, getRawExec, saveDb } from "../../../../../lib/db";
import { ensureStudioTables } from "../../../../../lib/studio-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title ? title.slice(0, 80) : null;
}

function optionalText(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next.slice(0, max) : null;
}

function cleanMode(value: unknown): string | null {
  if (value === "plan") return "plan";
  if (value === "default" || value === "review") return "default";
  return null;
}

function cleanProjectPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  if (!next) return null;
  return next.slice(0, 1024);
}

function sessionFromRow(row: unknown[]) {
  return {
    id: String(row[0]),
    title: String(row[1] ?? "New Studio Session"),
    defaultModel: row[2] ? String(row[2]) : null,
    mode: String(row[3] ?? "default"),
    createdAt: Number(row[4] ?? 0),
    updatedAt: Number(row[5] ?? 0),
    projectPath: row[6] ? String(row[6]) : null,
  };
}

function parseMetadata(value: unknown): unknown {
  if (!value) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const { session, error } = await requireActiveSession();
  if (error) return error;

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

  const messageRows = raw.exec(
    `SELECT id, role, content, metadata, created_at
     FROM studio_messages
     WHERE session_id = ? AND user_id = ?
     ORDER BY created_at ASC`,
    [sessionId, session.userId]
  )[0]?.values ?? [];

  const commandRows = raw.exec(
    `SELECT id, command_summary, command_hash, status, risk_level, exit_code, started_at, finished_at, created_at
     FROM studio_commands
     WHERE session_id = ? AND user_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [sessionId, session.userId]
  )[0]?.values ?? [];

  return NextResponse.json({
    session: sessionFromRow(sessionRows[0]),
    messages: messageRows.map((row) => ({
      id: String(row[0]),
      role: String(row[1]),
      content: String(row[2] ?? ""),
      metadata: parseMetadata(row[3]),
      createdAt: Number(row[4] ?? 0),
    })),
    commands: commandRows.map((row) => ({
      id: String(row[0]),
      summary: String(row[1] ?? ""),
      commandHash: String(row[2] ?? ""),
      status: String(row[3] ?? "pending_confirmation"),
      riskLevel: String(row[4] ?? "medium"),
      exitCode: row[5] === null || row[5] === undefined ? null : Number(row[5]),
      startedAt: row[6] ? Number(row[6]) : null,
      finishedAt: row[7] ? Number(row[7]) : null,
      createdAt: Number(row[8] ?? 0),
    })),
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const title = cleanTitle(body.title);
  const defaultModel = optionalText(body.defaultModel);
  const mode = cleanMode(body.mode);
  const projectPath = cleanProjectPath(body.projectPath);
  const now = Math.floor(Date.now() / 1000);

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const existingRows = raw.exec(
    "SELECT id FROM studio_sessions WHERE id = ? AND user_id = ? LIMIT 1",
    [sessionId, session.userId]
  )[0]?.values ?? [];
  if (!existingRows[0]) {
    return NextResponse.json({ error: "Studio session not found" }, { status: 404 });
  }

  if (title !== null) {
    raw.run("UPDATE studio_sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?", [
      title,
      now,
      sessionId,
      session.userId,
    ]);
  }
  if (defaultModel !== null) {
    raw.run("UPDATE studio_sessions SET default_model = ?, updated_at = ? WHERE id = ? AND user_id = ?", [
      defaultModel,
      now,
      sessionId,
      session.userId,
    ]);
  }
  if (mode !== null) {
    raw.run("UPDATE studio_sessions SET mode = ?, updated_at = ? WHERE id = ? AND user_id = ?", [
      mode,
      now,
      sessionId,
      session.userId,
    ]);
  }
  if (projectPath !== null) {
    raw.run("UPDATE studio_sessions SET project_path = ?, updated_at = ? WHERE id = ? AND user_id = ?", [
      projectPath,
      now,
      sessionId,
      session.userId,
    ]);
  }
  await saveDb();

  return NextResponse.json({ ok: true, updatedAt: now });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const existingRows = raw.exec(
    "SELECT id FROM studio_sessions WHERE id = ? AND user_id = ? LIMIT 1",
    [sessionId, session.userId]
  )[0]?.values ?? [];
  if (!existingRows[0]) {
    return NextResponse.json({ error: "Studio session not found" }, { status: 404 });
  }

  raw.run("DELETE FROM studio_messages WHERE session_id = ? AND user_id = ?", [sessionId, session.userId]);
  raw.run("DELETE FROM studio_commands WHERE session_id = ? AND user_id = ?", [sessionId, session.userId]);
  raw.run("DELETE FROM studio_sessions WHERE id = ? AND user_id = ?", [sessionId, session.userId]);
  await saveDb();

  return NextResponse.json({ ok: true });
}
