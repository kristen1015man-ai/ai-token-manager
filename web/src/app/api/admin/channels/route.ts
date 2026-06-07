import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../lib/db";
import { channels } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";
import { ensureEncrypted, ensureDecrypted } from "../../../../lib/crypto";
import { auditLog } from "../../../../lib/audit-log";
import { apiHandler, apiHandlerNoBody } from "../../../../lib/api-handler";

export const GET = apiHandlerNoBody(async () => {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db } = await getDb();
  const list = await db.select().from(channels).orderBy(channels.priority);

  return NextResponse.json({
    channels: list.map((ch) => {
      const decryptedKey = ensureDecrypted(ch.apiKey);
      const decryptedSecret = ch.accessKeySecret ? ensureDecrypted(ch.accessKeySecret) : null;
      return {
        ...ch,
        apiKey: decryptedKey.slice(0, 8) + "****", // 脱敏
        accessKeySecret: decryptedSecret ? decryptedSecret.slice(0, 4) + "****" : null, // 脱敏
      };
    }),
  });
});

export const POST = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const body = await request.json();
  const { name, baseUrl, apiKey, models, priority, status, currency, provider } = body;

  if (!name || !baseUrl || !apiKey || !models) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { db } = await getDb();
  const channelId = randomBytes(8).toString("hex");
  await db.insert(channels).values({
    id: channelId,
    name,
    baseUrl,
    apiKey: ensureEncrypted(apiKey),
    models: typeof models === "string" ? JSON.parse(models) : models,
    priority: priority ?? 0,
    status: status ?? "active",
    currency: currency ?? "CNY",
    provider: provider ?? null,
    createdAt: new Date(),
  });

  await saveDb();
  await auditLog(session.userId, "create", "channel", channelId, { name, provider, baseUrl });
  return NextResponse.json({ success: true });
});

export const PUT = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const body = await request.json();
  const { id, name, baseUrl, apiKey, models, priority, status, currency, provider,
          balance, balanceCurrency, balanceSyncMode, balanceAlertThreshold,
          accessKeyId, accessKeySecret } = body;

  if (!id) {
    return NextResponse.json({ error: "Missing channel id" }, { status: 400 });
  }

  const { db } = await getDb();
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (baseUrl !== undefined) updateData.baseUrl = baseUrl;
  if (apiKey !== undefined) updateData.apiKey = ensureEncrypted(apiKey);
  if (models !== undefined) updateData.models = typeof models === "string" ? JSON.parse(models) : models;
  if (priority !== undefined) updateData.priority = priority;
  if (status !== undefined) updateData.status = status;
  if (currency !== undefined) updateData.currency = currency;
  if (provider !== undefined) updateData.provider = provider;

  // 余额字段更新
  if (balance !== undefined) {
    updateData.balance = balance;
    updateData.balanceSyncedAt = new Date(); // 手动设余额时自动更新同步时间
  }
  if (balanceCurrency !== undefined) updateData.balanceCurrency = balanceCurrency;
  if (balanceSyncMode !== undefined) updateData.balanceSyncMode = balanceSyncMode;
  if (balanceAlertThreshold !== undefined) updateData.balanceAlertThreshold = balanceAlertThreshold;

  // 阿里云 AK/SK（Secret 加密存储）
  if (accessKeyId !== undefined) updateData.accessKeyId = accessKeyId;
  if (accessKeySecret !== undefined) updateData.accessKeySecret = ensureEncrypted(accessKeySecret);

  await db.update(channels).set(updateData).where(eq(channels.id, id));
  await saveDb();

  await auditLog(session.userId, "update", "channel", id, { updatedFields: Object.keys(updateData) });
  return NextResponse.json({ success: true });
});

export const DELETE = apiHandler(async (request: NextRequest) => {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "Missing channel id" }, { status: 400 });
  }

  const { db } = await getDb();
  await db.delete(channels).where(eq(channels.id, id));
  await saveDb();

  await auditLog(session.userId, "delete", "channel", id);
  return NextResponse.json({ success: true });
});
