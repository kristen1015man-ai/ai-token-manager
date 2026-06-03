import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "../../../../lib/db";
import { getAppAccessToken, fetchAllDepartmentsWithParent, getUserDepartmentIds } from "../../../../lib/feishu";
import { randomBytes } from "crypto";

const BASE_URL = "https://open.feishu.cn/open-apis";

/**
 * 部门分类枚举
 */
type DeptLevel = "center" | "department" | "group";

/**
 * POST /api/setup/sync-feishu
 * 从飞书拉取真实通讯录，按三层架构（中心/部门/组）存储
 *
 * 分类规则：
 * 1. 名称以"中心"结尾 → 中心级
 * 2. 深度1（根的直接子节点）→ 中心级
 * 3. 名称以"部"结尾 → 部门级
 * 4. 深度2（中心的直接子节点）→ 部门级
 * 5. 名称以"组"结尾 → 组级
 * 6. 深度3+ → 组级
 * 7. 其余 → 部门级（默认）
 */
export async function POST(request: NextRequest) {
  try {
    const appToken = await getAppAccessToken();

    // ===== 1. 运行数据库 migration：添加三列 =====
    const { sqlite } = await getDb();
    const dbAny = sqlite as any;

    const newCols = [
      ["group_name", "TEXT"],
      ["group_id", "TEXT"],
      ["center_name", "TEXT"],
      ["center_id", "TEXT"],
    ];
    for (const [col, type] of newCols) {
      try {
        dbAny.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
        console.log(`[Sync] 添加列 users.${col}`);
      } catch (e: any) {
        // SQLite 不允许重复加列，忽略 "duplicate column name" 错误
        if (!e.message?.includes("duplicate column name")) {
          console.log(`[Sync] ALTER TABLE ${col}: ${e.message}`);
        }
      }
    }

    // ===== 2. 获取所有部门（含父级关系） =====
    const allDepts = await fetchAllDepartmentsWithParent(appToken);
    console.log(`[Sync] 获取到 ${allDepts.length} 个部门`);

    // ===== 3. 构建部门树，分类每个部门 =====
    const deptMap = new Map<string, (typeof allDepts)[0]>();
    for (const d of allDepts) {
      deptMap.set(d.department_id, d);
    }

    // 计算深度
    const depthCache = new Map<string, number>();
    function calcDepth(id: string): number {
      if (id === "0" || !id) return 0;
      if (depthCache.has(id)) return depthCache.get(id)!;
      const dept = deptMap.get(id);
      if (!dept) return 1;
      const d = calcDepth(dept.parent_department_id) + 1;
      depthCache.set(id, d);
      return d;
    }

    // 分类每个部门
    const deptLevel = new Map<string, DeptLevel>();
    function classifyDept(id: string, name: string, depth: number): DeptLevel {
      // 名称规则优先
      if (name.endsWith("中心")) return "center";
      if (name.endsWith("组")) return "group";
      if (name.endsWith("部")) return "department";
      // 深度规则
      if (depth <= 1) return "center";
      if (depth === 2) return "department";
      return "group";
    }

    for (const d of allDepts) {
      const depth = calcDepth(d.department_id);
      deptLevel.set(d.department_id, classifyDept(d.department_id, d.name, depth));
      console.log(`[Sync] 部门: ${d.name} (depth=${depth}, level=${deptLevel.get(d.department_id)})`);
    }

    // 统计
    const centers = allDepts.filter((d) => deptLevel.get(d.department_id) === "center");
    const departments = allDepts.filter((d) => deptLevel.get(d.department_id) === "department");
    const groups = allDepts.filter((d) => deptLevel.get(d.department_id) === "group");
    console.log(`[Sync] 分类结果: 中心=${centers.length}, 部门=${departments.length}, 组=${groups.length}`);

    // ===== 4. 获取每个部门下的用户，采集所有用户 =====
    // 用 Map 去重（key = open_id），每个用户记录他所属的所有部门
    const userMap = new Map<string, {
      open_id: string;
      name: string;
      email: string;
      avatar_url: string;
      employee_no: string;
      deptIds: string[];
    }>();

    // 逐个部门获取用户列表
    const seenUserIds = new Set<string>();
    for (const dept of allDepts) {
      const deptUsers = await fetchDepartmentUsersRaw(appToken, dept.department_id);
      for (const u of deptUsers) {
        const openId = u.open_id || "";
        if (!openId) continue;
        if (!userMap.has(openId)) {
          // 获取用户详情
          const detail = await fetchUserDetailRaw(appToken, openId);
          userMap.set(openId, {
            open_id: openId,
            name: detail?.name || u.name || `员工_${userMap.size + 1}`,
            email: detail?.email || detail?.enterprise_email || "",
            avatar_url: detail?.avatar?.avatar_240 || "",
            employee_no: detail?.employee_no || "",
            deptIds: detail?.department_ids || [],
          });
        }
      }
    }

    console.log(`[Sync] 去重后 ${userMap.size} 个员工`);

    // ===== 5. 为每个用户分配三层架构 =====
    const adminIds = (process.env.ADMIN_IDS || "").split(",").map((e) => e.trim());
    const now = Math.floor(Date.now() / 1000);
    let created = 0;
    let updated = 0;

    for (const [openId, user] of userMap) {
      // 对用户的所有部门 ID 进行分类
      const userCenters: { id: string; name: string }[] = [];
      const userDepts: { id: string; name: string }[] = [];
      const userGroups: { id: string; name: string }[] = [];

      for (const did of user.deptIds) {
        const level = deptLevel.get(did);
        const d = deptMap.get(did);
        const name = d?.name || did;
        if (level === "center") userCenters.push({ id: did, name });
        else if (level === "department") userDepts.push({ id: did, name });
        else if (level === "group") userGroups.push({ id: did, name });
      }

      // 选最优：每个层级取第一个
      let centerName = userCenters[0]?.name || null;
      let centerId = userCenters[0]?.id || null;
      let deptName = userDepts[0]?.name || null;
      let deptId = userDepts[0]?.id || null;
      let groupName = userGroups[0]?.name || null;
      let groupId = userGroups[0]?.id || null;

      // ===== 处理负责人无部门级的情况 =====
      if (!deptName) {
        // 尝试从组级向上推导
        if (groupName && groupId) {
          const groupDept = deptMap.get(groupId);
          if (groupDept) {
            const parentId = groupDept.parent_department_id;
            if (parentId && parentId !== "0") {
              const parentLevel = deptLevel.get(parentId);
              if (parentLevel === "department") {
                const parentDept = deptMap.get(parentId);
                deptName = parentDept?.name || null;
                deptId = parentId;
                console.log(`[Sync] ${user.name}: 从组 ${groupName} 推导部门=${deptName}`);
              } else if (parentLevel === "center") {
                // 组的父级是中心 → 跳过部门级，直接归到中心下的默认部门
                const parentCenter = deptMap.get(parentId);
                deptName = `${parentCenter?.name || "中心"}-直属`;
                deptId = parentId; // 用中心ID做标记
                console.log(`[Sync] ${user.name}: 组 ${groupName} 直接挂在中心下，部门=${deptName}`);
              }
            }
          }
        }

        // 如果还没有，尝试从中心级向下找
        if (!deptName && centerId) {
          // 找中心下的第一个部门级子节点
          for (const d of allDepts) {
            if (d.parent_department_id === centerId && deptLevel.get(d.department_id) === "department") {
              deptName = d.name;
              deptId = d.department_id;
              console.log(`[Sync] ${user.name}: 从中心 ${centerName} 推导部门=${deptName}`);
              break;
            }
          }
        }

        // 实在找不到 → 标记为直属
        if (!deptName) {
          deptName = centerName ? `${centerName}-直属` : "未分配部门";
          deptId = centerId || "unassigned";
          console.log(`[Sync] ${user.name}: 无法推导部门级，标记为 ${deptName}`);
        }
      }

      // 如果用户有部门但没有中心，从部门向上推导
      if (!centerName && deptId) {
        const deptObj = deptMap.get(deptId);
        if (deptObj) {
          const parentId = deptObj.parent_department_id;
          if (parentId && parentId !== "0") {
            const parentDept = deptMap.get(parentId);
            if (parentDept && deptLevel.get(parentId) === "center") {
              centerName = parentDept.name;
              centerId = parentId;
            }
          }
        }
      }

      // ===== 6. 写入/更新数据库 =====
      const existing = dbAny.exec(`SELECT id, api_key FROM users WHERE feishu_id = ?`, [openId]);
      const role = adminIds.includes(openId) ? "admin" : "member";
      const emailPrefix = user.email ? user.email.split("@")[0] : "user";

      if (existing.length > 0 && existing[0].values.length > 0) {
        const userId = existing[0].values[0][0];
        dbAny.exec(
          `UPDATE users SET
            name = ?, avatar = ?, email = ?,
            department = ?, department_id = ?,
            group_name = ?, group_id = ?,
            center_name = ?, center_id = ?,
            employee_id = ?, role = ?, updated_at = ?
          WHERE id = ?`,
          [
            user.name, user.avatar_url || null, user.email,
            deptName, deptId,
            groupName, groupId,
            centerName, centerId,
            user.employee_no, role, now, userId,
          ]
        );
        updated++;
      } else {
        const userId = randomBytes(8).toString("hex");
        const apiKey = `sk-emp-${emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}-${randomBytes(3).toString("hex")}`;
        dbAny.exec(
          `INSERT INTO users (
            id, feishu_id, name, avatar, email,
            department, department_id,
            group_name, group_id,
            center_name, center_id,
            employee_id, api_key, role, status, monthly_quota, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 200, ?, ?)`,
          [
            userId, openId, user.name, user.avatar_url || null, user.email,
            deptName, deptId,
            groupName, groupId,
            centerName, centerId,
            user.employee_no, apiKey, role, now, now,
          ]
        );
        created++;
      }
    }

    await saveDb();

    // 输出明细供检查
    console.log(`\n========== 同步结果明细 ==========`);
    const allResult = dbAny.exec(
      `SELECT name, center_name, department, group_name, email FROM users ORDER BY center_name, department, group_name`
    );
    if (allResult[0]?.values) {
      for (const r of allResult[0].values) {
        console.log(`  ${String(r[0])} | 中心=${String(r[1] || "-")} | 部门=${String(r[2] || "-")} | 组=${String(r[3] || "-")} | ${String(r[4] || "")}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: "飞书通讯录同步完成（三层架构）",
      stats: {
        totalDepartments: allDepts.length,
        centers: centers.length,
        departments: departments.length,
        groups: groups.length,
        totalUsers: userMap.size,
        created,
        updated,
      },
      summary: {
        centers: centers.map((d) => d.name),
        departments: departments.map((d) => d.name),
        groups: groups.map((d) => d.name),
      },
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
 * 获取某部门下的员工列表（原始数据）
 */
async function fetchDepartmentUsersRaw(appToken: string, departmentId: string) {
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
 * 获取单个用户详细信息
 */
async function fetchUserDetailRaw(appToken: string, openId: string) {
  try {
    const resp = await fetch(
      `${BASE_URL}/contact/v3/users/${openId}?user_id_type=open_id&department_id_type=department_id`,
      { headers: { Authorization: `Bearer ${appToken}` } }
    );
    const data = await resp.json();
    if (data.code !== 0) return null;
    return data.data?.user || null;
  } catch {
    return null;
  }
}
