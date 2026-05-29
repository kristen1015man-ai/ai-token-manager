import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSession } from "../../../../lib/auth";
import { getDb, saveDb } from "../../../../lib/db";
import { users } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db } = await getDb();
  const result = await db
    .select({ apiKey: users.apiKey })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (result.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const key = result[0].apiKey;
  // 脱敏显示
  const masked = key.slice(0, 11) + "****" + key.slice(-4);

  return NextResponse.json({
    apiKey: key,
    maskedKey: masked,
    configCommand: `export OPENAI_API_KEY=${key}\nexport OPENAI_BASE_URL=http://localhost:3001/v1`,
  });
}

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db } = await getDb();
  const newKey = `sk-emp-${randomBytes(8).toString("hex")}`;

  await db
    .update(users)
    .set({ apiKey: newKey, updatedAt: new Date() })
    .where(eq(users.id, session.userId));

  await saveDb();

  const masked = newKey.slice(0, 11) + "****" + newKey.slice(-4);

  return NextResponse.json({
    apiKey: newKey,
    maskedKey: masked,
    configCommand: `export OPENAI_API_KEY=${newKey}\nexport OPENAI_BASE_URL=http://localhost:3001/v1`,
  });
}
