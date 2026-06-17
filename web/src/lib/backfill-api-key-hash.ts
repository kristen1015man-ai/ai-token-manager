import { getDb, saveDb, type SqliteExec } from "./db";
import { ensureDecrypted, searchableHash } from "./crypto";

/**
 * 回填已有用户的 api_key_hash
 *
 * SEC-02 迁移：新架构用 HMAC-SHA256 hash 做 SQL WHERE 精确匹配，
 * 但存量用户的 hash 列为 NULL。此函数在服务启动时执行一次，
 * 为所有 hash 为空的用户计算并写入 hash。
 *
 * 幂等：只处理 api_key_hash IS NULL 的行，重复执行无副作用。
 */
export async function backfillApiKeyHash(): Promise<void> {
  try {
    const { sqlite } = await getDb();
    const dbAny = sqlite as unknown as SqliteExec;

    // 检查 api_key_hash 列是否存在（防御性检查）
    const colCheck = dbAny.exec(`PRAGMA table_info(users)`);
    const cols = new Set((colCheck[0]?.values ?? []).map((r: unknown[]) => String(r[1])));
    if (!cols.has("api_key_hash")) {
      console.log("[backfill] api_key_hash 列不存在，跳过回填");
      return;
    }

    // 查找需要回填的用户
    const rows = dbAny.exec(`SELECT id, api_key FROM users WHERE api_key_hash IS NULL`);
    if (!rows[0] || rows[0].values.length === 0) {
      return; // 无需回填
    }

    let count = 0;
    for (const row of rows[0].values) {
      const [userId, encryptedKey] = row as [string, string];
      try {
        const decryptedKey = ensureDecrypted(encryptedKey);
        const hash = searchableHash(decryptedKey);
        dbAny.run(
          `UPDATE users SET api_key_hash = ? WHERE id = ?`,
          [hash, userId]
        );
        count++;
      } catch (err) {
        console.error(`[backfill] 用户 ${userId} 回填失败:`, err);
      }
    }

    if (count > 0) {
      await saveDb();
      console.log(`[backfill] 已回填 ${count} 个用户的 api_key_hash`);
    }
  } catch (err) {
    console.error("[backfill] api_key_hash 回填失败:", err);
  }
}
