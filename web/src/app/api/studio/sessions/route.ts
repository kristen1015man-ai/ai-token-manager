import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../lib/admin-check";
import { getDb, getRawExec, saveDb } from "../../../../lib/db";
import { ensureStudioTables } from "../../../../lib/studio-db";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

function cleanTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  return title.slice(0, 80) || "New Studio Session";
}

function cleanMode(value: unknown): string {
  if (value === "plan") return "plan";
  return "default";
}

function optionalText(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next.slice(0, max) : null;
}

function clampNonNegativeInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function cleanProjectPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  if (!next) return null;
  return next.slice(0, 1024);
}

export async function GET(request: NextRequest) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const offset = clampNonNegativeInt(request.nextUrl.searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  const limit = clampNonNegativeInt(request.nextUrl.searchParams.get("limit"), 50, MAX_LIMIT);

  const totalRow = raw.exec(
    `SELECT COUNT(*) FROM studio_sessions WHERE user_id = ?`,
    [session.userId]
  )[0]?.values ?? [];
  const total = Number(totalRow[0]?.[0] ?? 0);

  const rows = raw.exec(
    `SELECT id, title, default_model, mode, created_at, updated_at, project_path
     FROM studio_sessions
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT ? OFFSET ?`,
    [session.userId, limit, offset]
  )[0]?.values ?? [];

  return NextResponse.json({
    sessions: rows.map((row) => ({
      id: String(row[0]),
      title: String(row[1] ?? "New Studio Session"),
      defaultModel: row[2] ? String(row[2]) : null,
      mode: String(row[3] ?? "default"),
      createdAt: Number(row[4] ?? 0),
      updatedAt: Number(row[5] ?? 0),
      projectPath: row[6] ? String(row[6]) : null,
    })),
    total,
    offset,
    limit,
  });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const title = cleanTitle(body.title);
  const defaultModel = optionalText(body.defaultModel);
  const mode = cleanMode(body.mode);
  const projectPath = cleanProjectPath(body.projectPath);

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  raw.run(
    `INSERT INTO studio_sessions (id, user_id, title, default_model, mode, created_at, updated_at, project_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, session.userId, title, defaultModel, mode, now, now, projectPath]
  );
  await saveDb();

  return NextResponse.json(
    {
      session: {
        id,
        title,
        defaultModel,
        mode,
        createdAt: now,
        updatedAt: now,
        projectPath,
      },
    },
    { status: 201 }
  );
}
