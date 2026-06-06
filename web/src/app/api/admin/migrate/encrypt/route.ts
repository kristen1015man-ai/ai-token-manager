import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { getDb, saveDb } from "../../../../../lib/db";
import { channels, users } from "../../../../../../../shared/schema";
import { isEncrypted, ensureEncrypted } from "../../../../../lib/crypto";
import { auditLog } from "../../../../../lib/audit-log";

/**
 * POST /api/admin/migrate/encrypt
 * 一次性迁移：扫描所有明文敏感字段并加密
 * 幂等操作——已加密的值自动跳过
 *
 * 覆盖字段：
 * - channels.apiKey
 * - channels.accessKeySecret
 * - users.apiKey
 */
export async function POST() {
  const { session, error: authError } = await requireAdmin();
  if (authError) return authError;

  const { db } = await getDb();
  const result = {
    channels: { total: 0, encrypted: 0, skipped: 0 },
    users: { total: 0, encrypted: 0, skipped: 0 },
  };

  // 1. 加密 channels.apiKey 和 channels.accessKeySecret
  const allChannels = await db.select().from(channels);
  result.channels.total = allChannels.length;

  for (const ch of allChannels) {
    const updates: Record<string, string> = {};
    let needsUpdate = false;

    if (ch.apiKey && !isEncrypted(ch.apiKey)) {
      updates.apiKey = ensureEncrypted(ch.apiKey);
      needsUpdate = true;
    }

    if (ch.accessKeySecret && !isEncrypted(ch.accessKeySecret)) {
      updates.accessKeySecret = ensureEncrypted(ch.accessKeySecret);
      needsUpdate = true;
    }

    if (needsUpdate) {
      const { eq } = await import("drizzle-orm");
      await db.update(channels).set(updates).where(eq(channels.id, ch.id));
      result.channels.encrypted++;
    } else {
      result.channels.skipped++;
    }
  }

  // 2. 加密 users.apiKey
  const allUsers = await db.select().from(users);
  result.users.total = allUsers.length;

  for (const user of allUsers) {
    if (user.apiKey && !isEncrypted(user.apiKey)) {
      const { eq } = await import("drizzle-orm");
      await db.update(users).set({ apiKey: ensureEncrypted(user.apiKey) }).where(eq(users.id, user.id));
      result.users.encrypted++;
    } else {
      result.users.skipped++;
    }
  }

  await saveDb();

  await auditLog(session.userId, "migrate", "system", "encrypt-sensitive-fields", result);

  return NextResponse.json({
    success: true,
    message: `迁移完成：${result.channels.encrypted} 个渠道密钥、${result.users.encrypted} 个用户密钥已加密`,
    details: result,
  });
}
