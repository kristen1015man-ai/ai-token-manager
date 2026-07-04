import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../../lib/admin-check";
import { getDb, getRawExec, saveDb } from "../../../../../lib/db";
import { ensureStudioTables } from "../../../../../lib/studio-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ commandId: string }>;
};

const ALLOWED_STATUSES = new Set([
  "pending_confirmation",
  "cancelled",
  "approved",
  "running",
  "completed",
  "failed",
]);

function cleanStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return ALLOWED_STATUSES.has(value) ? value : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { commandId } = await context.params;
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const status = cleanStatus(body.status);
  if (!status) {
    return NextResponse.json({ error: "Valid command status is required" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const existingRows = raw.exec(
    "SELECT id FROM studio_commands WHERE id = ? AND user_id = ? LIMIT 1",
    [commandId, session.userId]
  )[0]?.values ?? [];
  if (!existingRows[0]) {
    return NextResponse.json({ error: "Studio command not found" }, { status: 404 });
  }

  if (status === "running") {
    raw.run(
      "UPDATE studio_commands SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND user_id = ?",
      [status, now, commandId, session.userId]
    );
  } else if (status === "completed" || status === "failed" || status === "cancelled") {
    raw.run(
      "UPDATE studio_commands SET status = ?, finished_at = COALESCE(finished_at, ?) WHERE id = ? AND user_id = ?",
      [status, now, commandId, session.userId]
    );
  } else {
    raw.run("UPDATE studio_commands SET status = ? WHERE id = ? AND user_id = ?", [
      status,
      commandId,
      session.userId,
    ]);
  }
  await saveDb();

  return NextResponse.json({ ok: true, status, updatedAt: now });
}
