import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../lib/admin-check";
import { getDb, getRawExec, saveDb } from "../../../../lib/db";
import { ensureStudioTables } from "../../../../lib/studio-db";

export const dynamic = "force-dynamic";

type RiskLevel = "low" | "medium" | "high";

function cleanText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.slice(0, max);
}

function cleanRisk(value: unknown): RiskLevel {
  return value === "low" || value === "high" ? value : "medium";
}

function commandHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function GET(request: NextRequest) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const rows = sessionId
    ? raw.exec(
        `SELECT id, session_id, command_summary, command_hash, status, risk_level, exit_code, started_at, finished_at, created_at
         FROM studio_commands
         WHERE user_id = ? AND session_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [session.userId, sessionId]
      )[0]?.values ?? []
    : raw.exec(
        `SELECT id, session_id, command_summary, command_hash, status, risk_level, exit_code, started_at, finished_at, created_at
         FROM studio_commands
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [session.userId]
      )[0]?.values ?? [];

  return NextResponse.json({
    commands: rows.map((row) => ({
      id: String(row[0]),
      sessionId: row[1] ? String(row[1]) : null,
      summary: String(row[2] ?? ""),
      commandHash: String(row[3] ?? ""),
      status: String(row[4] ?? "pending_confirmation"),
      riskLevel: String(row[5] ?? "medium"),
      exitCode: row[6] === null || row[6] === undefined ? null : Number(row[6]),
      startedAt: row[7] ? Number(row[7]) : null,
      finishedAt: row[8] ? Number(row[8]) : null,
      createdAt: Number(row[9] ?? 0),
    })),
  });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const sessionId = cleanText(body.sessionId, 80) || null;
  const summary = cleanText(body.summary, 240);
  const command = cleanText(body.command, 10_000);
  const riskLevel = cleanRisk(body.riskLevel);
  if (!summary || !command) {
    return NextResponse.json({ error: "Command summary and command are required" }, { status: 400 });
  }

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  if (sessionId) {
    const sessionRows = raw.exec(
      "SELECT id FROM studio_sessions WHERE id = ? AND user_id = ? LIMIT 1",
      [sessionId, session.userId]
    )[0]?.values ?? [];
    if (!sessionRows[0]) {
      return NextResponse.json({ error: "Studio session not found" }, { status: 404 });
    }
  }

  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const hash = commandHash(command);
  raw.run(
    `INSERT INTO studio_commands
      (id, session_id, user_id, device_id, project_id, mode, command_summary, command_hash,
       status, risk_level, exit_code, output_hash, started_at, finished_at, created_at)
     VALUES
      (?, ?, ?, NULL, NULL, 'review', ?, ?, 'pending_confirmation', ?, NULL, NULL, NULL, NULL, ?)`,
    [id, sessionId, session.userId, summary, hash, riskLevel, now]
  );
  if (sessionId) {
    raw.run("UPDATE studio_sessions SET updated_at = ? WHERE id = ? AND user_id = ?", [
      now,
      sessionId,
      session.userId,
    ]);
  }
  await saveDb();

  return NextResponse.json(
    {
      command: {
        id,
        sessionId,
        summary,
        commandHash: hash,
        status: "pending_confirmation",
        riskLevel,
        createdAt: now,
      },
    },
    { status: 201 }
  );
}
