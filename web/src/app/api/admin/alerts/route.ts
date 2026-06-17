import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";
import { alertLogs } from "../../../../../../shared/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const alerts = await db.select().from(alertLogs).orderBy(desc(alertLogs.sentAt)).limit(100);

  return NextResponse.json({
    alerts: alerts.map((a) => ({
      id: a.id,
      type: a.type,
      targetId: a.targetId,
      message: a.message,
      sentAt: a.sentAt,
    })),
  });
}
