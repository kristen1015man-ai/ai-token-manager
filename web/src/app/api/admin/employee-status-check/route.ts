import { NextResponse } from "next/server";
import { getDb, saveDb } from "../../../../lib/db";
import { getAppAccessToken, getUserDetail } from "../../../../lib/feishu";

/**
 * POST /api/admin/employee-status-check
 *
 * 检查所有 active 用户在飞书中的在职状态。
 * 如果用户在飞书中已离职/停用/删除，则将其 status 设为 disabled。
 *
 * 认证：INTERNAL_API_KEY Bearer token（由 auto-sync 调用）
 * 或管理员 session（手动触发）
 */
export async function POST(request: Request) {
  // 认证：INTERNAL_API_KEY 或管理员 session
  const authHeader = request.headers.get("Authorization") || "";
  const internalKey = process.env.INTERNAL_API_KEY;

  if (internalKey && authHeader === `Bearer ${internalKey}`) {
    // Internal API 调用 — 通过
  } else {
    // 尝试 session 认证
    const { getSession } = await import("../../../../lib/auth");
    const { parseRoles } = await import("../../../../lib/permissions");
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const roles = parseRoles(session.role);
    if (!roles.includes("admin")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const { db, sqlite } = await getDb();
    const dbAny = sqlite as unknown as {
      exec(sql: string, params?: unknown[]): { columns: string[]; values: unknown[][] }[];
    };

    // 获取所有 active 且有 feishu_id 的用户
    const rows = dbAny.exec(
      `SELECT id, feishu_id, name FROM users WHERE status = 'active' AND feishu_id LIKE 'ou_%'`
    );
    if (!rows[0]?.values?.length) {
      return NextResponse.json({ checked: 0, disabled: 0, users: [] });
    }

    const activeUsers = rows[0].values.map((r) => ({
      id: String(r[0]),
      feishuId: String(r[1]),
      name: String(r[2]),
    }));

    console.log(`[EmployeeCheck] 开始检查 ${activeUsers.length} 名在职员工状态...`);

    // 获取飞书 app_access_token
    let appToken: string;
    try {
      appToken = await getAppAccessToken();
    } catch (e) {
      console.error("[EmployeeCheck] 获取飞书 token 失败:", e);
      return NextResponse.json({ error: "飞书认证失败" }, { status: 500 });
    }

    // 逐个检查（飞书 API 无批量查询，需逐个调用）
    const disabledUsers: { id: string; name: string; reason: string }[] = [];
    let checked = 0;

    for (const user of activeUsers) {
      checked++;
      try {
        const detail = await getUserDetail(appToken, user.feishuId);

        if (!detail) {
          // 用户在飞书中不存在 → 离职
          disabledUsers.push({ id: user.id, name: user.name, reason: "飞书用户不存在" });
          continue;
        }

        // 飞书用户状态：1=未激活, 2=离职, 3=停用, 4=退出
        // 正常在职不返回 status 字段或 status=0
        const status = detail.status;
        if (status === 2 || status === 3 || status === 4) {
          const statusMap: Record<number, string> = { 2: "已离职", 3: "已停用", 4: "已退出" };
          disabledUsers.push({
            id: user.id,
            name: user.name,
            reason: statusMap[status as number] || `状态码=${status}`,
          });
        }

        // 避免触发飞书 API 频率限制（50 次/秒）
        if (checked % 20 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (e) {
        console.warn(`[EmployeeCheck] 检查 ${user.name}(${user.feishuId}) 失败:`, e);
        // 单个用户查询失败不中断整体流程
      }
    }

    // 批量停用离职用户
    const now = Math.floor(Date.now() / 1000);
    for (const du of disabledUsers) {
      dbAny.exec(`UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?`, [now, du.id]);
      console.log(`[EmployeeCheck] 停用: ${du.name} — ${du.reason}`);
    }

    if (disabledUsers.length > 0) {
      await saveDb();
      console.log(`[EmployeeCheck] 共停用 ${disabledUsers.length} 名离职员工`);

      // 飞书通知管理员
      try {
        const { sendPrivateMessage } = await import("../../../../lib/feishu-bot");
        const adminRows = dbAny.exec(
          `SELECT feishu_id FROM users WHERE role LIKE '%admin%' AND status = 'active' AND feishu_id LIKE 'ou_%'`
        );
        const adminFeishuIds = (adminRows[0]?.values || []).map((r) => String(r[0]));

        if (adminFeishuIds.length > 0) {
          const names = disabledUsers.slice(0, 10).map((d) => `${d.name}（${d.reason}）`).join("\n");
          const suffix = disabledUsers.length > 10 ? `\n...共 ${disabledUsers.length} 人` : "";
          const message = `📋 员工状态检查通知\n\n以下员工已离职/停用，系统已自动停用其账号：\n${names}${suffix}`;

          for (const adminId of adminFeishuIds) {
            sendPrivateMessage(adminId, message).catch(() => {});
          }
        }
      } catch (e) {
        console.warn("[EmployeeCheck] 离职通知发送失败:", e);
      }
    } else {
      console.log(`[EmployeeCheck] 检查完成，所有 ${checked} 名员工均在职`);
    }

    return NextResponse.json({
      checked,
      disabled: disabledUsers.length,
      users: disabledUsers,
    });
  } catch (error) {
    console.error("[EmployeeCheck] 错误:", error);
    return NextResponse.json(
      { error: "员工状态检查失败" },
      { status: 500 }
    );
  }
}
