import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb, type SqliteExec } from "../../../../lib/db";
import { channels } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";
import { ensureEncrypted, ensureDecrypted } from "../../../../lib/crypto";
import { auditLog } from "../../../../lib/audit-log";
import { apiHandler, apiHandlerNoBody } from "../../../../lib/api-handler";

/** 允许执行 PRAGMA table_info 的安全表名白名单 */
const SAFE_TABLE_NAMES = new Set(["channels", "users", "admin_logs", "quota_rules", "usage_logs", "prices"]);

/** 检查表中是否有某列（仅允许白名单表名） */
function hasColumn(sqlite: SqliteExec, table: string, col: string): boolean {
  if (!SAFE_TABLE_NAMES.has(table)) {
    throw new Error(`Unsafe table name in PRAGMA: ${table}`);
  }
  const cols = sqlite.exec(`PRAGMA table_info(${table})`);
  return cols[0]?.values?.some((c) => c[1] === col) ?? false;
}

/** 确保 channels 表有余额相关新列 */
let balanceMigrationDone = false;
async function ensureBalanceColumns(sqlite: SqliteExec) {
  if (balanceMigrationDone) return;
  const newCols: [string, string][] = [
    ["balance", "REAL"],
    ["balance_currency", "TEXT"],
    ["balance_sync_mode", "TEXT"],
    ["balance_synced_at", "INTEGER"],
    ["balance_alert_threshold", "REAL"],
    ["access_key_id", "TEXT"],
    ["access_key_secret", "TEXT"],
  ];
  for (const [col, type] of newCols) {
    if (!hasColumn(sqlite, "channels", col)) {
      sqlite.exec(`ALTER TABLE channels ADD COLUMN ${col} ${type}`);
      console.log(`[Migration] channels 表新增列: ${col}`);
    }
  }
  balanceMigrationDone = true;
}

export const GET = apiHandlerNoBody(async () => {
  const { error } = await requireAdmin();
  if (error) return error;

  const { db, sqlite } = await getDb();
  await ensureBalanceColumns(sqlite as unknown as SqliteExec);
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

  const { db, sqlite } = await getDb();
  await ensureBalanceColumns(sqlite as unknown as SqliteExec);
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

  const { db, sqlite } = await getDb();
  await ensureBalanceColumns(sqlite as unknown as SqliteExec);
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

  const { db, sqlite } = await getDb();
  await ensureBalanceColumns(sqlite as unknown as SqliteExec);
  await db.delete(channels).where(eq(channels.id, id));
  await saveDb();

  await auditLog(session.userId, "delete", "channel", id);
  return NextResponse.json({ success: true });
});
