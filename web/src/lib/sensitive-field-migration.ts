import { eq } from "drizzle-orm";
import { channels, users } from "../../../shared/schema";
import { ensureDecrypted, ensureEncrypted, isEncrypted, searchableHash } from "./crypto";
import { getDb, saveDb } from "./db";

export interface SensitiveFieldMigrationResult {
  channels: { total: number; encrypted: number; skipped: number };
  users: { total: number; encrypted: number; hashed: number; skipped: number };
}

export async function migrateSensitiveFields(): Promise<SensitiveFieldMigrationResult> {
  const { db } = await getDb();
  const result: SensitiveFieldMigrationResult = {
    channels: { total: 0, encrypted: 0, skipped: 0 },
    users: { total: 0, encrypted: 0, hashed: 0, skipped: 0 },
  };

  const allChannels = await db.select().from(channels);
  result.channels.total = allChannels.length;

  for (const channel of allChannels) {
    const updates: Record<string, string> = {};

    if (channel.apiKey && !isEncrypted(channel.apiKey)) {
      updates.apiKey = ensureEncrypted(channel.apiKey);
    }

    if (channel.accessKeySecret && !isEncrypted(channel.accessKeySecret)) {
      updates.accessKeySecret = ensureEncrypted(channel.accessKeySecret);
    }

    if (Object.keys(updates).length === 0) {
      result.channels.skipped += 1;
      continue;
    }

    await db.update(channels).set(updates).where(eq(channels.id, channel.id));
    result.channels.encrypted += 1;
  }

  const allUsers = await db.select().from(users);
  result.users.total = allUsers.length;

  for (const user of allUsers) {
    if (!user.apiKey) {
      result.users.skipped += 1;
      continue;
    }

    const updates: Record<string, string> = {};
    const plainKey = ensureDecrypted(user.apiKey);
    const nextHash = searchableHash(plainKey);

    if (!isEncrypted(user.apiKey)) {
      updates.apiKey = ensureEncrypted(user.apiKey);
      result.users.encrypted += 1;
    }

    if (user.apiKeyHash !== nextHash) {
      updates.apiKeyHash = nextHash;
      result.users.hashed += 1;
    }

    if (Object.keys(updates).length === 0) {
      result.users.skipped += 1;
      continue;
    }

    await db.update(users).set(updates).where(eq(users.id, user.id));
  }

  await saveDb();
  return result;
}
