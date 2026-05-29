import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";
import { channels } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const list = await db.select().from(channels).orderBy(channels.priority);

  return NextResponse.json({
    channels: list.map((ch) => ({
      ...ch,
      apiKey: ch.apiKey.slice(0, 8) + "****", // 脱敏
    })),
  });
}

export async function POST(request: NextRequest) {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const body = await request.json();
  const { name, baseUrl, apiKey, models, priority, status } = body;

  if (!name || !baseUrl || !apiKey || !models) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { db } = await getDb();
  await db.insert(channels).values({
    id: randomBytes(8).toString("hex"),
    name,
    baseUrl,
    apiKey,
    models: typeof models === "string" ? JSON.parse(models) : models,
    priority: priority ?? 0,
    status: status ?? "active",
    createdAt: new Date(),
  });

  await saveDb();
  return NextResponse.json({ success: true });
}

export async function PUT(request: NextRequest) {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const body = await request.json();
  const { id, name, baseUrl, apiKey, models, priority, status } = body;

  if (!id) {
    return NextResponse.json({ error: "Missing channel id" }, { status: 400 });
  }

  const { db } = await getDb();
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (baseUrl !== undefined) updateData.baseUrl = baseUrl;
  if (apiKey !== undefined) updateData.apiKey = apiKey;
  if (models !== undefined) updateData.models = typeof models === "string" ? JSON.parse(models) : models;
  if (priority !== undefined) updateData.priority = priority;
  if (status !== undefined) updateData.status = status;

  await db.update(channels).set(updateData).where(eq(channels.id, id));
  await saveDb();

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "Missing channel id" }, { status: 400 });
  }

  const { db } = await getDb();
  await db.delete(channels).where(eq(channels.id, id));
  await saveDb();

  return NextResponse.json({ success: true });
}
