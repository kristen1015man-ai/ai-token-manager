import { type SqliteExec } from "../../../../lib/db";

/**
 * 停用离职员工 + 清理种子假用户
 * 从 executeSync 的步骤 6 提取。
 */
export async function cleanupDepartedAndSeed(
  db: SqliteExec,
  realFeishuIds: Set<string>,
  adminIds: string[],
  now: number
): Promise<{
  disabledDeparted: number;
  cleanedSeedUsers: number;
  transferredLogs: number;
}> {
  // 查找所有不在当前飞书通讯录中的用户
  const allDbUsers = db.exec(`SELECT id, feishu_id, name, department, status FROM users`);
  const seedUsers: { id: string; feishuId: string; name: string; dept: string }[] = [];
  const departedUsers: { id: string; feishuId: string; name: string; dept: string }[] = [];

  if (allDbUsers[0]?.values) {
    for (const r of allDbUsers[0].values) {
      const fid = String(r[1] || "");
      if (!realFeishuIds.has(fid)) {
        if (fid && fid.startsWith("ou_")) {
          // 真实飞书用户不在当前通讯录 → 离职员工
          departedUsers.push({ id: String(r[0]), feishuId: fid, name: String(r[2]), dept: String(r[3] || "") });
        } else {
          // 种子假用户（无 feishu_id 或非标准格式）
          seedUsers.push({ id: String(r[0]), feishuId: fid, name: String(r[2]), dept: String(r[3] || "") });
        }
      }
    }
  }

  // 停用离职员工（不删除，保留历史记录）
  let disabledCount = 0;
  if (departedUsers.length > 0) {
    console.log(`[Sync] 发现 ${departedUsers.length} 名离职员工，开始停用...`);
    for (const du of departedUsers) {
      // 只停用当前仍为 active 的用户
      const row = allDbUsers[0]?.values.find((r: unknown[]) => String(r[0]) === du.id);
      const currentStatus = row ? String(row[4] || "active") : "active";
      if (currentStatus === "disabled") continue;

      db.exec(`UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?`, [now, du.id]);
      disabledCount++;
      console.log(`[Sync] 离职停用: ${du.name} (${du.feishuId})`);
    }

    // 异步通知管理员
    if (disabledCount > 0) {
      console.log(`[Sync] 共停用 ${disabledCount} 名离职员工`);
      try {
        const { sendPrivateMessage } = await import("../../../../lib/feishu-bot");
        const adminFeishuIds = adminIds.filter((id: string) => id.startsWith("ou_"));
        if (adminFeishuIds.length > 0) {
          const names = departedUsers.slice(0, 10).map(d => d.name).join("、");
          const suffix = departedUsers.length > 10 ? `\n...共 ${departedUsers.length} 人` : "";
          for (const adminId of adminFeishuIds) {
            sendPrivateMessage(adminId, `📋 员工离职通知\n\n以下员工已离职，系统已自动停用其账号：\n${names}${suffix}`).catch(() => {});
          }
        }
      } catch (e) {
        console.warn("[Sync] 离职通知发送失败:", e);
      }
    }
  }

  // 清理种子假用户
  let cleanedCount = 0;
  let transferredLogs = 0;

  if (seedUsers.length > 0) {
    console.log(`[Sync] 发现 ${seedUsers.length} 个种子假用户，开始清理...`);

    // 获取所有真实用户列表（用于转移用量记录）
    const realUsers = db.exec(`SELECT id, name, department FROM users WHERE feishu_id IN (${Array.from(realFeishuIds).map(() => "?").join(",")})`, Array.from(realFeishuIds));
    const realUserList: { id: string; name: string; dept: string }[] = [];
    if (realUsers[0]?.values) {
      for (const r of realUsers[0].values) {
        realUserList.push({ id: String(r[0]), name: String(r[1]), dept: String(r[2] || "") });
      }
    }

    for (const su of seedUsers) {
      const logsCount = db.exec(`SELECT COUNT(*) FROM usage_logs WHERE user_id = ?`, [su.id]);
      const count = logsCount[0]?.values?.[0]?.[0] ? Number(logsCount[0].values[0][0]) : 0;

      if (count > 0 && realUserList.length > 0) {
        let target = realUserList.find(ru => ru.dept === su.dept);
        if (!target) {
          target = realUserList[Math.floor(Math.random() * realUserList.length)];
        }
        if (target) {
          db.exec(`UPDATE usage_logs SET user_id = ? WHERE user_id = ?`, [target.id, su.id]);
          transferredLogs += count;
        }
      }

      db.exec(`DELETE FROM quota_rules WHERE target_id = ?`, [su.id]);
      db.exec(`DELETE FROM users WHERE id = ?`, [su.id]);
      cleanedCount++;
    }
  }

  return { disabledDeparted: disabledCount, cleanedSeedUsers: cleanedCount, transferredLogs };
}
