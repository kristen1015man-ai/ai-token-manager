import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { auditLog } from "../../../../../lib/audit-log";
import { migrateSensitiveFields } from "../../../../../lib/sensitive-field-migration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const result = await migrateSensitiveFields();
  await auditLog(session.userId, "migrate", "system", "encrypt-sensitive-fields", {
    channels: result.channels,
    users: result.users,
  });

  return NextResponse.json({
    success: true,
    message: `Migration complete: encrypted ${result.channels.encrypted} channel rows and ${result.users.encrypted} user rows`,
    details: result,
  });
}
