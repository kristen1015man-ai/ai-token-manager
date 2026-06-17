import { NextResponse } from "next/server";
import { getDb, getRawExec, saveDb } from "../../../../lib/db";
import { getAppAccessToken, getUserDetail } from "../../../../lib/feishu";
import { requireAdmin } from "../../../../lib/admin-check";
import { formatBeijingDateTime } from "../../../../lib/beijing-time";
import { safeErrorSummary } from "../../../../lib/safe-error";

interface Candidate {
  id: string;
  name: string;
  reason: string;
}

function readMaxAutoDisable(): number {
  const parsed = Number(process.env.FEISHU_MAX_AUTO_DISABLE_DEPARTED ?? 5);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
}

async function authenticate(request: Request) {
  const authHeader = request.headers.get("Authorization") || "";
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey && authHeader === `Bearer ${internalKey}`) return null;
  const { error } = await requireAdmin();
  return error || null;
}

export async function POST(request: Request) {
  const authError = await authenticate(request);
  if (authError) return authError;

  try {
    const { sqlite } = await getDb();
    const db = getRawExec(sqlite);
    const rows = db.exec(
      `SELECT id, feishu_id, name FROM users WHERE status = 'active' AND feishu_id LIKE 'ou_%'`
    );

    if (!rows[0]?.values?.length) {
      return NextResponse.json({ checked: 0, disabled: 0, candidates: 0, skipped: 0, unknown: 0, users: [] });
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
      return NextResponse.json({ error: "Feishu auth failed" }, { status: 500 });
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
      return NextResponse.json({
        checked,
        disabled: 0,
        candidates: candidates.length,
        skipped: candidates.length,
        unknown: unknownUsers.length,
        users: candidates,
      });
    }

    const now = Math.floor(Date.now() / 1000);
    for (const user of candidates) {
      db.exec(`UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?`, [now, user.id]);
      console.log(`[EmployeeCheck] Disabled: ${user.name} - ${user.reason}`);
    }

    if (candidates.length > 0) {
      await saveDb();
      try {
        const { notifyAlert } = await import("../../../../lib/notification-router");
        const names = candidates.slice(0, 10).map((d) => `- **${d.name}** (${d.reason})`).join("\n");
        const suffix = candidates.length > 10 ? `\n\n...共 ${candidates.length} 人` : "";
        const message = `以下员工飞书状态为离职/停用，系统已自动停用账号：\n${names}${suffix}`;
        await notifyAlert({
          type: "employee_departed",
          targetId: "batch",
          message,
          card: {
            title: `员工状态检查通知（${candidates.length} 人停用）`,
            template: "orange",
            elements: [message, `检查时间：${formatBeijingDateTime()}`],
          },
        });
      } catch (e) {
        console.warn("[EmployeeCheck] Failed to send notification:", safeErrorSummary(e));
      }
    } else {
      console.log(`[EmployeeCheck] Done. No users disabled. checked=${checked}`);
    }

    return NextResponse.json({
      checked,
      disabled: candidates.length,
      candidates: candidates.length,
      skipped: 0,
      unknown: unknownUsers.length,
      users: candidates,
    });
  } catch (error) {
    console.error("[EmployeeCheck] Error:", error);
    return NextResponse.json({ error: "Employee status check failed" }, { status: 500 });
  }
}
