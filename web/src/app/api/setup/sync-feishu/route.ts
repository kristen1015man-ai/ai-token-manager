import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "../../../../lib/db";
import { getAppAccessToken } from "../../../../lib/feishu";
import { randomBytes } from "crypto";

const BASE_URL = "https://open.feishu.cn/open-apis";

/**
 * POST /api/setup/sync-feishu
 * 从飞书拉取真实通讯录（部门 + 员工）导入系统
 *
 * 经验证：
 * - 部门列表 API 返回 department_id 格式（无 od- 前缀）
 * - 查员工必须用 department_id_type=department_id
 * - 用户 name/email 需要 contact:user.base:readonly 等字段权限（发布后生效）
 */
export async function POST(request: NextRequest) {
  try {
    const appToken = await getAppAccessToken();

    // 1. 获取所有部门
    const departments = await fetchAllDepartments(appToken);
    console.log(`[Sync] 获取到 ${departments.length} 个部门`);

    // 2. 获取每个部门下的员工（用户列表只返回 ID，name/email 需要单独获取）
    const allUsers: Array<{
      name: string; open_id: string; email: string;
      department_name: string; department_id: string;
      employee_no: string; avatar_url: string;
    }> = [];

    for (const dept of departments) {
      const deptUsers = await fetchDepartmentUsers(appToken, dept.department_id);
      console.log(`[Sync] 部门 ${dept.name} (${dept.department_id}) 获取到 ${deptUsers.length} 个员工`);

      // 逐个获取用户详情（拿到 name、avatar）
      for (const u of deptUsers) {
        const detail = await fetchUserDetail(appToken, u.open_id);
        const userName = detail?.name || u.name || `员工${allUsers.length + 1}`;
        const userEmail = detail?.email || detail?.enterprise_email || u.email || "";
        const empNo = detail?.employee_no || u.employee_no || "";
        const avatarUrl = detail?.avatar?.avatar_240 || u.avatar?.avatar_240 || "";

        allUsers.push({
          name: userName,
          open_id: u.open_id || "",
          email: userEmail,
          department_name: dept.name,
          department_id: dept.department_id,
          employee_no: empNo,
          avatar_url: avatarUrl,
        });
      }
    }

    // 去重（同一人可能在多个部门）
    const seen = new Set<string>();
    const uniqueUsers = allUsers.filter((u) => {
      if (!u.open_id || seen.has(u.open_id)) return false;
      seen.add(u.open_id);
      return true;
    });

    console.log(`[Sync] 去重后 ${uniqueUsers.length} 个员工`);
    // 打印员工摘要
    for (const u of uniqueUsers) {
      console.log(`[Sync] 员工: ${u.name}, email=${u.email}, dept=${u.department_name}`);
    }

    // 3. 写入数据库
    const { sqlite } = await getDb();
    const dbAny = sqlite as any;
    const adminIds = (process.env.ADMIN_IDS || "").split(",").map((e) => e.trim());
    const now = Math.floor(Date.now() / 1000);

    // 3.1 建部门表（如果不存在）并同步部门层级
    dbAny.exec(`CREATE TABLE IF NOT EXISTS departments (
      department_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT NOT NULL DEFAULT '0',
      level INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`);
    // 清空旧部门数据重新同步
    dbAny.exec(`DELETE FROM departments`);
    for (const dept of departments) {
      dbAny.exec(
        `INSERT INTO departments (department_id, name, parent_id, level, member_count, updated_at) VALUES (?, ?, ?, ?, 0, ?)`,
        [dept.department_id, dept.name, dept.parent_id, dept.level, now]
      );
    }
    console.log(`[Sync] 同步 ${departments.length} 个部门层级关系`);

    let created = 0;
    let updated = 0;

    for (const u of uniqueUsers) {
      const existing = dbAny.exec(`SELECT id, api_key FROM users WHERE feishu_id = ?`, [u.open_id]);
      const role = adminIds.includes(u.open_id) ? "admin" : "member";
      const emailPrefix = u.email ? u.email.split("@")[0] : "user";

      if (existing.length > 0 && existing[0].values.length > 0) {
        const userId = existing[0].values[0][0];
        dbAny.exec(
          `UPDATE users SET name = ?, avatar = ?, email = ?, department = ?, department_id = ?, employee_id = ?, role = ?, updated_at = ? WHERE id = ?`,
          [u.name, u.avatar_url || null, u.email, u.department_name, u.department_id, u.employee_no, role, now, userId]
        );
        updated++;
      } else {
        const userId = randomBytes(8).toString("hex");
        const apiKey = `sk-emp-${emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}-${randomBytes(3).toString("hex")}`;
        dbAny.exec(
          `INSERT INTO users (id, feishu_id, name, avatar, email, department, department_id, employee_id, api_key, role, status, monthly_quota, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 200, ?, ?)`,
          [userId, u.open_id, u.name, u.avatar_url || null, u.email, u.department_name, u.department_id, u.employee_no, apiKey, role, now, now]
        );
        created++;
      }
    }

    await saveDb();

    return NextResponse.json({
      success: true,
      message: "飞书通讯录同步完成",
      stats: {
        departments: departments.length,
        totalUsers: uniqueUsers.length,
        created,
        updated,
      },
      departments: departments.map((d) => ({ id: d.department_id, name: d.name, parent_id: d.parent_id, level: d.level })),
      users: uniqueUsers.map(u => ({ name: u.name, email: u.email, department: u.department_name })),
    });
  } catch (error) {
    console.error("[Sync] 同步失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "同步失败" },
      { status: 500 }
    );
  }
}

/**
 * 获取所有部门列表（从根部门 0 递归获取）
 * 同时保存层级关系：parent_id 和 level
 */
async function fetchAllDepartments(appToken: string) {
  const allDepts: Array<{ department_id: string; name: string; parent_id: string; level: number }> = [];

  async function fetchSubDepts(parentId: string, level: number) {
    const resp = await fetch(
      `${BASE_URL}/contact/v3/departments?parent_department_id=${parentId}&department_id_type=department_id&fetch_child=false&page_size=50`,
      { headers: { Authorization: `Bearer ${appToken}` } }
    );
    const data = await resp.json();

    if (data.code !== 0) {
      console.log(`[Sync] 获取子部门失败 (parent=${parentId}): code=${data.code}, msg=${data.msg}`);
      return;
    }
    const items = data.data?.items || [];
    for (const dept of items) {
      const deptId = dept.department_id || dept.id || "";
      allDepts.push({ department_id: deptId, name: dept.name, parent_id: parentId, level });
      // 递归获取子部门
      await fetchSubDepts(deptId, level + 1);
    }
  }

  await fetchSubDepts("0", 0);
  return allDepts;
}

/**
 * 获取某部门下的员工列表
 * 必须使用 department_id_type=department_id（经实测验证）
 */
async function fetchDepartmentUsers(appToken: string, departmentId: string) {
  const allUsers: any[] = [];
  let pageToken = "";

  do {
    const url = `${BASE_URL}/contact/v3/users?department_id=${departmentId}&department_id_type=department_id&user_id_type=open_id&page_size=50${pageToken ? `&page_token=${pageToken}` : ""}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${appToken}` } });
    const data = await resp.json();

    if (data.code !== 0) {
      console.log(`[Sync] 部门 ${departmentId} 获取员工失败: code=${data.code}, msg=${data.msg}`);
      break;
    }
    const items = data.data?.items || [];
    allUsers.push(...items);
    pageToken = data.data?.has_more ? data.data?.page_token : "";
  } while (pageToken);

  return allUsers;
}

/**
 * 获取单个用户详细信息（name、email、employee_no 等字段）
 * 需要权限：contact:user.base:readonly, contact:user.email:readonly 等
 */
async function fetchUserDetail(appToken: string, openId: string) {
  try {
    const resp = await fetch(
      `${BASE_URL}/contact/v3/users/${openId}?user_id_type=open_id&department_id_type=department_id`,
      { headers: { Authorization: `Bearer ${appToken}` } }
    );
    const data = await resp.json();
    if (data.code !== 0) {
      return null;
    }
    return data.data?.user || null;
  } catch {
    return null;
  }
}
