import { NextRequest, NextResponse } from "next/server";
import { getDb, getRawExec, scheduleSave } from "../../../../../../lib/db";
import { requireInternalRequest } from "../../../../../../lib/internal-auth";

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  let body: { reservationId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const reservationId = typeof body.reservationId === "string" ? body.reservationId.trim() : "";
  if (!reservationId) {
    return NextResponse.json({ error: "Missing reservationId" }, { status: 400 });
  }

  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  try {
    db.exec("DELETE FROM quota_reservations WHERE id = ?", [reservationId]);
    scheduleSave();
  } catch {
    // Older deployments may receive a release before the migration table exists.
  }

  return NextResponse.json({ success: true });
}
