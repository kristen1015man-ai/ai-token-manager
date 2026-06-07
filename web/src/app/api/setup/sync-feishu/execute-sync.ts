import { getDb, saveDb, getRawExec } from "../../../../lib/db";
import { getAppAccessToken, fetchAllDepartmentsWithParent } from "../../../../lib/feishu";
import { randomBytes } from "crypto";
import { pinyin } from "pinyin-pro";
import { type DeptLevel } from "./constants";
import { fetchDepartmentUsersRaw, fetchUserDetailRaw } from "./api-helpers";
import { normalizeAndProtect } from "./normalize";
import { cleanupDepartedAndSeed } from "./cleanup";

/** executeSync() 返回值类型 */
export interface SyncResult {
  success: boolean;
  message: string;
  stats: {
    totalDepartments: number; centers: number;
    departments: number; groups: number;
    totalUsers: number; created: number; updated: number; regeneratedKeys: number;
    cleanedSeedUsers: number; transferredLogs: number;
    normalizedCount: number; centerFixedCount: number; adminProtectedCount: number;
    disabledDeparted: number;
  };
  summary: { centers: string[]; departments: string[]; groups: string[] };
}

export async function executeSync(): Promise<SyncResult> {
  const appToken = await getAppAccessToken();

  // ===== 1. Migration =====
  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);

  // 确保新表存在（同步不会 drop 表，只做增量）
  db.exec(`CREATE TABLE IF NOT EXISTS alert_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  const newCols = [
    ["group_name", "TEXT"],
    ["group_id", "TEXT"],
    ["center_name", "TEXT"],
    ["center_id", "TEXT"],
  ];
  for (const [col, type] of newCols) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg?.includes("duplicate column name")) {
        console.log(`[Sync] ALTER TABLE ${col}: ${msg}`);
      }
    }
  }

  // ===== 2. 获取所有部门 =====
  const allDepts = await fetchAllDepartmentsWithParent(appToken);
  console.log(`[Sync] 获取到 ${allDepts.length} 个部门`);

  // ===== 3. 构建树 + 分类 =====
  const deptMap = new Map<string, (typeof allDepts)[0]>();
  for (const d of allDepts) deptMap.set(d.department_id, d);

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

  const deptLevel = new Map<string, DeptLevel>();
  function classifyDept(_id: string, name: string, depth: number): DeptLevel {
    if (name.endsWith("中心")) return "center";
    if (name.endsWith("组")) return "group";
    if (name.endsWith("部")) return "department";
    if (depth <= 1) return "center";
    if (depth === 2) return "department";
    return "group";
  }

  for (const d of allDepts) {
    const depth = calcDepth(d.department_id);
    deptLevel.set(d.department_id, classifyDept(d.department_id, d.name, depth));
    console.log(`[Sync] 部门: ${d.name} (depth=${depth}, level=${deptLevel.get(d.department_id)})`);
  }

  const centers = allDepts.filter((d) => deptLevel.get(d.department_id) === "center");
  const departments = allDepts.filter((d) => deptLevel.get(d.department_id) === "department");
  const groups = allDepts.filter((d) => deptLevel.get(d.department_id) === "group");
  console.log(`[Sync] 分类结果: 中心=${centers.length}, 部门=${departments.length}, 组=${groups.length}`);

  // ===== 4. 采集用户 =====
  const userMap = new Map<string, {
    open_id: string; name: string; email: string;
    avatar_url: string; employee_no: string; deptIds: string[];
  }>();

  for (const dept of allDepts) {
    try {
      const deptUsers = await fetchDepartmentUsersRaw(appToken, dept.department_id);
      for (const u of deptUsers) {
        const openId = u.open_id || "";
        if (!openId || userMap.has(openId)) continue;
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
    } catch (_e) {
      // 单个部门失败不中断整体
    }
  }
  console.log(`[Sync] 去重后 ${userMap.size} 个员工`);

  // ===== 5. 三层分配 + 入库 =====
  const adminIds = (process.env.ADMIN_IDS || "").split(",").map((e) => e.trim());
  const now = Math.floor(Date.now() / 1000);
  let created = 0, updated = 0, regeneratedKeys = 0;

  for (const [openId, user] of userMap) {
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

    let centerName = userCenters[0]?.name || null;
    let centerId = userCenters[0]?.id || null;
    let deptName = userDepts[0]?.name || null;
    let deptId = userDepts[0]?.id || null;
    let groupName = userGroups[0]?.name || null;
    let groupId = userGroups[0]?.id || null;

    // 处理无部门级
    if (!deptName) {
      if (groupName && groupId) {
        const groupDept = deptMap.get(groupId);
        if (groupDept) {
          const parentId = groupDept.parent_department_id;
          const parentLevel = parentId ? deptLevel.get(parentId) : undefined;
          if (parentLevel === "department") {
            const pd = deptMap.get(parentId!);
            deptName = pd?.name || null;
            deptId = parentId!;
          } else if (parentLevel === "center") {
            const pc = deptMap.get(parentId!);
            deptName = `${pc?.name || "中心"}-直属`;
            deptId = parentId!;
          }
        }
      }
      if (!deptName && centerId) {
        for (const d of allDepts) {
          if (d.parent_department_id === centerId && deptLevel.get(d.department_id) === "department") {
            deptName = d.name; deptId = d.department_id; break;
          }
        }
      }
      if (!deptName) {
        deptName = centerName ? `${centerName}-直属` : "未分配部门";
        deptId = centerId || "unassigned";
      }
    }

    // 无中心则向上推导
    if (!centerName && deptId) {
      const deptObj = deptMap.get(deptId);
      if (deptObj?.parent_department_id) {
        const parentDept = deptMap.get(deptObj.parent_department_id);
        if (parentDept && deptLevel.get(deptObj.parent_department_id) === "center") {
          centerName = parentDept.name;
          centerId = deptObj.parent_department_id;
        }
      }
    }

    // 写入
    const existing = db.exec(`SELECT id, api_key, role FROM users WHERE feishu_id = ?`, [openId]);
    const emailPrefix = user.email ? user.email.split("@")[0] : "user";

    if (existing.length > 0 && existing[0].values.length > 0) {
      const userId = existing[0].values[0][0];
      const existingApiKey = String(existing[0].values[0][1] || "");
      let existingRole = String(existing[0].values[0][2] || "member");
      if (adminIds.includes(openId) && !existingRole.split(",").map((r: string) => r.trim()).includes("admin")) {
        existingRole = existingRole === "member" ? "admin" : existingRole + ",admin";
      }
      if (!adminIds.includes(openId) && existingRole === "admin") {
        existingRole = "member";
      }
      let newApiKey: string | null = null;
      if (existingApiKey.startsWith("sk-emp-")) {
        const namePinyin = pinyin(user.name || "", { toneType: "none", type: "array" }).join("").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "user";
        newApiKey = `sk-${namePinyin}-${randomBytes(6).toString("hex")}`;
        regeneratedKeys++;
      }
      if (newApiKey) {
        db.exec(
          `UPDATE users SET name=?, avatar=?, email=?, department=?, department_id=?, group_name=?, group_id=?, center_name=?, center_id=?, employee_id=?, api_key=?, role=?, updated_at=? WHERE id=?`,
          [user.name, user.avatar_url || null, user.email, deptName, deptId, groupName, groupId, centerName, centerId, user.employee_no, newApiKey, existingRole, now, userId]
        );
      } else {
        db.exec(
          `UPDATE users SET name=?, avatar=?, email=?, department=?, department_id=?, group_name=?, group_id=?, center_name=?, center_id=?, employee_id=?, role=?, updated_at=? WHERE id=?`,
          [user.name, user.avatar_url || null, user.email, deptName, deptId, groupName, groupId, centerName, centerId, user.employee_no, existingRole, now, userId]
        );
      }
      updated++;
    } else {
      const userId = randomBytes(8).toString("hex");
      const namePinyin = pinyin(user.name || "", { toneType: "none", type: "array" }).join("").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "user";
      const apiKey = `sk-${namePinyin}-${randomBytes(6).toString("hex")}`;
      const role = adminIds.includes(openId) ? "admin" : "member";
      db.exec(
        `INSERT INTO users (id,feishu_id,name,avatar,email,department,department_id,group_name,group_id,center_name,center_id,employee_id,api_key,role,status,monthly_quota,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',200,?,?)`,
        [userId, openId, user.name, user.avatar_url || null, user.email, deptName, deptId, groupName, groupId, centerName, centerId, user.employee_no, apiKey, role, now, now]
      );
      created++;
    }
  }

  // ===== 5.5 部门规范化 + 中心归属补全 + 管理员保护 =====
  const { normalizedCount, centerFixedCount, adminProtectedCount } = await normalizeAndProtect(db);

  // ===== 6. 停用离职员工 + 清理种子假用户 =====
  const realFeishuIds = new Set(userMap.keys());
  const { disabledDeparted, cleanedSeedUsers, transferredLogs } = await cleanupDepartedAndSeed(db, realFeishuIds, adminIds, now);

  await saveDb();

  // 输出明细
  console.log(`\n========== 同步结果明细 ==========`);
  const allResult = db.exec(`SELECT name, center_name, department, group_name, email FROM users ORDER BY center_name, department, group_name`);
  if (allResult[0]?.values) {
    for (const r of allResult[0].values) {
      console.log(`  ${String(r[0])} | 中心=${String(r[1] || "-")} | 部门=${String(r[2] || "-")} | 组=${String(r[3] || "-")} | ${String(r[4] || "")}`);
    }
  }

  return {
    success: true,
    message: "飞书通讯录同步完成（三层架构）",
    stats: {
      totalDepartments: allDepts.length, centers: centers.length,
      departments: departments.length, groups: groups.length,
      totalUsers: userMap.size, created, updated, regeneratedKeys,
      cleanedSeedUsers, transferredLogs, normalizedCount, centerFixedCount, adminProtectedCount,
      disabledDeparted,
    },
    summary: { centers: centers.map((d) => d.name), departments: departments.map((d) => d.name), groups: groups.map((d) => d.name) },
  };
}
