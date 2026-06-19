import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { users } from "../../../../../../../shared/schema";
import { sendCardMessage } from "../../../../../lib/feishu-bot";
import { formatBeijingDateTime } from "../../../../../lib/beijing-time";
import { requireAdmin } from "../../../../../lib/admin-check";

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const targetName = typeof body.userName === "string" && body.userName.trim()
    ? body.userName.trim()
    : "";

  if (!targetName) {
    return NextResponse.json({ error: "Missing userName" }, { status: 400 });
  }

  const { db } = await getDb();
  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      feishuId: users.feishuId,
      department: users.department,
    })
    .from(users)
    .where(eq(users.name, targetName))
    .limit(1);

  if (userRows.length === 0) {
    return NextResponse.json({ error: `User not found: ${targetName}` }, { status: 404 });
  }

  const user = userRows[0];
  if (!user.feishuId) {
    return NextResponse.json({ error: `User has no Feishu open_id: ${targetName}` }, { status: 400 });
  }

  const hourlyCost = 88.88;
  const sevenDayAvg = 3.52;
  const multiplier = (hourlyCost / sevenDayAvg).toFixed(1);

  await sendCardMessage(user.feishuId, "open_id", {
    title: "Anomaly alert test",
    template: "red",
    elements: [
      `**${user.name}** (${user.department || "unknown"})\nLast 1 hour: ¥${hourlyCost.toFixed(2)}\n7-day hourly average: ¥${sevenDayAvg.toFixed(2)}/h (${multiplier}x)`,
      `Checked at: ${formatBeijingDateTime()}`,
      "This is a simulated alert used to verify Feishu notification delivery.",
    ],
  });

  return NextResponse.json({
    success: true,
    message: `Sent anomaly test alert to ${user.name}`,
    user: { name: user.name, feishuId: user.feishuId },
  });
}
