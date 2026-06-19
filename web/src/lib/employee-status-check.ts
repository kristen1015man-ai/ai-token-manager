import { getDb, getRawExec, saveDb } from "./db";
import { getAppAccessToken, getUserDetail } from "./feishu";
import { formatBeijingDateTime } from "./beijing-time";
import { safeErrorSummary } from "./safe-error";

interface Candidate {
  id: string;
  name: string;
  reason: string;
}

export interface EmployeeStatusCheckResult {
  checked: number;
  disabled: number;
  candidates: number;
  skipped: number;
  unknown: number;
  users: Candidate[];
}

function readMaxAutoDisable(): number {
  const parsed = Number(process.env.FEISHU_MAX_AUTO_DISABLE_DEPARTED ?? 5);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
}

export async function runEmployeeStatusCheck(): Promise<EmployeeStatusCheckResult> {
  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  const rows = db.exec(
    `SELECT id, feishu_id, name FROM users WHERE status = 'active' AND feishu_id LIKE 'ou_%'`
  );

  if (!rows[0]?.values?.length) {
    return { checked: 0, disabled: 0, candidates: 0, skipped: 0, unknown: 0, users: [] };
  }

  const activeUsers = rows[0].values.map((r) => ({
    id: String(r[0]),
    feishuId: String(r[1]),
    name: String(r[2]),
  }));

  console.log(`[EmployeeCheck] Checking ${activeUsers.length} active employees...`);

  let appToken: string;
  try {
    appToken = await getAppAccessToken();
  } catch (e) {
    console.error("[EmployeeCheck] Failed to get Feishu token:", e);
    throw new Error("Feishu auth failed");
  }

  const candidates: Candidate[] = [];
  const unknownUsers: Candidate[] = [];
  let checked = 0;

  for (const user of activeUsers) {
    checked++;
    try {
      const detail = await getUserDetail(appToken, user.feishuId);
      if (!detail) {
        unknownUsers.push({ id: user.id, name: user.name, reason: "Feishu detail unavailable" });
        continue;
      }

      const status = detail.status;
      if (status === 2 || status === 3 || status === 4) {
        const statusMap: Record<number, string> = { 2: "departed", 3: "disabled", 4: "exited" };
        candidates.push({
          id: user.id,
          name: user.name,
          reason: statusMap[status as number] || `status=${status}`,
        });
      }

      if (checked % 20 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (e) {
      console.warn(`[EmployeeCheck] Failed to check ${user.name} (${user.feishuId}):`, e);
      unknownUsers.push({ id: user.id, name: user.name, reason: "check failed" });
    }
  }

  if (unknownUsers.length > 0) {
    console.warn(`[EmployeeCheck] ${unknownUsers.length} user details unavailable; they will not be disabled`);
  }

  const maxAutoDisable = readMaxAutoDisable();
  if (candidates.length > maxAutoDisable) {
    console.warn(`[EmployeeCheck] Skip auto-disable: ${candidates.length} candidates exceeds max ${maxAutoDisable}`);
    return {
      checked,
      disabled: 0,
      candidates: candidates.length,
      skipped: candidates.length,
      unknown: unknownUsers.length,
      users: candidates,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  for (const user of candidates) {
    db.exec("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?", [now, user.id]);
    console.log(`[EmployeeCheck] Disabled: ${user.name} - ${user.reason}`);
  }

  if (candidates.length > 0) {
    await saveDb();
    try {
      const { notifyAlert } = await import("./notification-router");
      const names = candidates.slice(0, 10).map((d) => `- **${d.name}** (${d.reason})`).join("\n");
      const suffix = candidates.length > 10 ? `\n\n... total ${candidates.length}` : "";
      const message = `The following employees appear departed/disabled in Feishu and were disabled in Sparkloom:\n${names}${suffix}`;
      await notifyAlert({
        type: "employee_departed",
        targetId: "batch",
        message,
        card: {
          title: `Employee status check: ${candidates.length} disabled`,
          template: "orange",
          elements: [message, `Checked at: ${formatBeijingDateTime()}`],
        },
      });
    } catch (e) {
      console.warn("[EmployeeCheck] Failed to send notification:", safeErrorSummary(e));
    }
  } else {
    console.log(`[EmployeeCheck] Done. No users disabled. checked=${checked}`);
  }

  return {
    checked,
    disabled: candidates.length,
    candidates: candidates.length,
    skipped: 0,
    unknown: unknownUsers.length,
    users: candidates,
  };
}
