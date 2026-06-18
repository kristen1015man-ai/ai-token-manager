import { NextRequest, NextResponse } from "next/server";
import { getDb, getRawExec, saveDb } from "../../../../lib/db";
import { randomBytes } from "crypto";
import { requireInternalRequest } from "../../../../lib/internal-auth";
import { calculateCost } from "../../../../lib/proxy/cache";
import { checkQuotaAlertsForUsers } from "../../../../lib/quota-alerts";

function ensureReservationTable(db: ReturnType<typeof getRawExec>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quota_reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      department_id TEXT,
      channel_id TEXT,
      model TEXT,
      estimated_cost REAL NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
}

/**
 * POST /api/internal/usage
 * Internal endpoint used by proxy to report usage.
 * The web service owns SQLite writes and recalculates cost from current prices.
 * Body: { records: UsageRecord[] }
 */
export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  let body: { records?: unknown[] };
  try {
    body = await request.json();
  } catch {
    console.warn("[Internal/Usage] Invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const records = body.records;
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: "records must be a non-empty array" }, { status: 400 });
  }

  try {
    const { sqlite } = await getDb();
    const db = getRawExec(sqlite);
    ensureReservationTable(db);

    const accepted: string[] = [];
    const acceptedUserIds = new Set<string>();
    const rejected: Array<{ id: string; userId: string; model: string; channelId: string; error: string }> = [];

    for (const r of records) {
      const rec = r as Record<string, unknown>;
      const id = String(rec.id || randomBytes(8).toString("hex"));
      const model = String(rec.model || "");
      const channelId = String(rec.channelId || "");
      const userId = String(rec.userId || "");
      const reservationId = typeof rec.reservationId === "string" ? rec.reservationId : "";

      try {
        let inputTokens = Number(rec.inputTokens ?? 0);
        let outputTokens = Number(rec.outputTokens ?? 0);
        let totalTokens = Number(rec.totalTokens ?? inputTokens + outputTokens);
        let cachedTokens = Number(rec.cachedTokens ?? 0);
        if (!userId || !model || !channelId) {
          throw new Error("Usage record missing userId, model, or channelId");
        }
        if (!Number.isFinite(inputTokens) || inputTokens < 0) inputTokens = 0;
        if (!Number.isFinite(outputTokens) || outputTokens < 0) outputTokens = 0;
        if (!Number.isFinite(cachedTokens) || cachedTokens < 0) cachedTokens = 0;
        if (!Number.isFinite(totalTokens) || totalTokens < 0) {
          totalTokens = inputTokens + outputTokens;
        }
        if (inputTokens === 0 && outputTokens === 0 && Number.isFinite(totalTokens) && totalTokens > 0) {
          outputTokens = totalTokens;
        }
        totalTokens = Math.max(totalTokens, inputTokens + outputTokens);
        cachedTokens = Math.min(cachedTokens, inputTokens);
        if (totalTokens <= 0) {
          throw new Error("Usage record has zero tokens");
        }

        const cost = await calculateCost(channelId, model, inputTokens, outputTokens, cachedTokens);
        const createdAtMs = Number(rec.createdAt);
        const createdAt = Number.isFinite(createdAtMs) && createdAtMs > 0
          ? Math.floor(createdAtMs > 10_000_000_000 ? createdAtMs / 1000 : createdAtMs)
          : Math.floor(Date.now() / 1000);

        db.exec(
          `INSERT OR IGNORE INTO usage_logs
            (id, user_id, model, input_tokens, output_tokens, cached_tokens, total_tokens, cost, channel_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            userId,
            model,
            inputTokens,
            outputTokens,
            cachedTokens,
            totalTokens,
            cost,
            channelId,
            createdAt,
          ]
        );
        if (reservationId) {
          db.exec("DELETE FROM quota_reservations WHERE id = ?", [reservationId]);
        }
        accepted.push(id);
        acceptedUserIds.add(userId);
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown usage record error";
        console.error("[InternalAPI] Rejected usage record:", { id, userId, model, channelId, error });
        rejected.push({ id, userId, model, channelId, error });
      }
    }

    if (accepted.length > 0) {
      await saveDb();
    }

    if (acceptedUserIds.size > 0) {
      try {
        await checkQuotaAlertsForUsers([...acceptedUserIds]);
      } catch (alertErr) {
        console.error("[InternalAPI] Failed to check quota alerts:", alertErr);
      }
    }

    return NextResponse.json({
      success: rejected.length === 0,
      count: accepted.length,
      accepted: accepted.length,
      rejected: rejected.length,
      rejectedRecords: rejected.slice(0, 10),
    });
  } catch (err) {
    console.error("[InternalAPI] Failed to record usage:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
