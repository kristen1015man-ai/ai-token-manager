import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";
import { adminLogs } from "../../../../../../shared/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const logs = await db.select().from(adminLogs).orderBy(desc(adminLogs.createdAt)).limit(200);

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      adminId: l.adminId,
      action: l.action,
      targetType: l.targetType,
      targetId: l.targetId,
      detail: l.detail,
      createdAt: l.createdAt,
    })),
  });
}
