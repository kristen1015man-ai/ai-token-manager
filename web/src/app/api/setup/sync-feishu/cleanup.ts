import { type SqliteExec } from "../../../../lib/db";

interface CleanupOptions {
  allowDepartedDisable?: boolean;
  skipDepartedReason?: string;
  maxAutoDisableDeparted?: number;
}

interface CleanupResult {
  disabledDeparted: number;
  departedCandidates: number;
  skippedDeparted: number;
  cleanedSeedUsers: number;
  transferredLogs: number;
}

interface UserRow {
  id: string;
  feishuId: string;
  name: string;
  dept: string;
  status: string;
}

function readAllUsers(db: SqliteExec): UserRow[] {
  const result = db.exec(`SELECT id, feishu_id, name, department, status FROM users`);
  return (result[0]?.values || []).map((r) => ({
    id: String(r[0]),
    feishuId: String(r[1] || ""),
    name: String(r[2] || ""),
    dept: String(r[3] || ""),
    status: String(r[4] || "active"),
  }));
}

async function notifyDepartedAdmins(adminIds: string[], departedUsers: UserRow[]) {
  try {
    const { sendPrivateMessage } = await import("../../../../lib/feishu-bot");
    const adminFeishuIds = adminIds.filter((id) => id.startsWith("ou_"));
    if (adminFeishuIds.length === 0) return;

    const names = departedUsers.slice(0, 10).map((d) => d.name).join("、");
    const suffix = departedUsers.length > 10 ? `\n...共 ${departedUsers.length} 人` : "";
    const message = `员工离职通知\n\n以下员工已离职，系统已自动停用其账号：\n${names}${suffix}`;

    for (const adminId of adminFeishuIds) {
      sendPrivateMessage(adminId, message).catch(() => {});
    }
  } catch (e) {
    console.warn("[Sync] departed notification failed:", e);
  }
}

export async function cleanupDepartedAndSeed(
  db: SqliteExec,
  realFeishuIds: Set<string>,
  adminIds: string[],
  now: number,
  options: CleanupOptions = {}
): Promise<CleanupResult> {
  const allUsers = readAllUsers(db);
  const seedUsers: UserRow[] = [];
  const departedUsers: UserRow[] = [];

  for (const user of allUsers) {
    if (realFeishuIds.has(user.feishuId)) continue;
    if (user.feishuId && user.feishuId.startsWith("ou_")) {
      departedUsers.push(user);
    } else {
      seedUsers.push(user);
    }
  }

  let disabledDeparted = 0;
  let skippedDeparted = 0;
  const maxAutoDisableDeparted = options.maxAutoDisableDeparted ?? 5;

  if (departedUsers.length > 0) {
    const allowDisable =
      options.allowDepartedDisable !== false &&
      departedUsers.length <= maxAutoDisableDeparted;

    if (!allowDisable) {
      skippedDeparted = departedUsers.length;
      const reason = options.skipDepartedReason || `candidate count ${departedUsers.length} exceeds max ${maxAutoDisableDeparted}`;
      console.warn(`[Sync] Skip departed auto-disable: ${reason}`);
    } else {
      console.log(`[Sync] Found ${departedUsers.length} departed candidates, disabling active accounts...`);
      for (const user of departedUsers) {
        if (user.status === "disabled") continue;
        db.exec(`UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?`, [now, user.id]);
        disabledDeparted++;
        console.log(`[Sync] Departed disabled: ${user.name} (${user.feishuId})`);
      }

      if (disabledDeparted > 0) {
        console.log(`[Sync] Disabled ${disabledDeparted} departed employees`);
        await notifyDepartedAdmins(adminIds, departedUsers);
      }
    }
  }

  let cleanedSeedUsers = 0;
  let transferredLogs = 0;

  if (seedUsers.length > 0) {
    console.log(`[Sync] Found ${seedUsers.length} seed users, cleaning...`);
    const realIds = Array.from(realFeishuIds);
    const realUserList: Array<{ id: string; name: string; dept: string }> = [];

    if (realIds.length > 0) {
      const placeholders = realIds.map(() => "?").join(",");
      const realUsers = db.exec(`SELECT id, name, department FROM users WHERE feishu_id IN (${placeholders})`, realIds);
      for (const r of realUsers[0]?.values || []) {
        realUserList.push({ id: String(r[0]), name: String(r[1]), dept: String(r[2] || "") });
      }
    }

    for (const seed of seedUsers) {
      const logsCount = db.exec(`SELECT COUNT(*) FROM usage_logs WHERE user_id = ?`, [seed.id]);
      const count = Number(logsCount[0]?.values?.[0]?.[0] ?? 0);

      if (count > 0 && realUserList.length > 0) {
        let target = realUserList.find((ru) => ru.dept === seed.dept);
        if (!target) target = realUserList[Math.floor(Math.random() * realUserList.length)];
        if (target) {
          db.exec(`UPDATE usage_logs SET user_id = ? WHERE user_id = ?`, [target.id, seed.id]);
          transferredLogs += count;
        }
      }

      db.exec(`DELETE FROM quota_rules WHERE target_id = ?`, [seed.id]);
      db.exec(`DELETE FROM users WHERE id = ?`, [seed.id]);
      cleanedSeedUsers++;
    }
  }

  return {
    disabledDeparted,
    departedCandidates: departedUsers.length,
    skippedDeparted,
    cleanedSeedUsers,
    transferredLogs,
  };
}
