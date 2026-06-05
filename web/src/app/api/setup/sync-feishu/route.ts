import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "../../../../lib/db";
import { getAppAccessToken, fetchAllDepartmentsWithParent } from "../../../../lib/feishu";
import { randomBytes } from "crypto";
import { pinyin } from "pinyin-pro";

const BASE_URL = "https://open.feishu.cn/open-apis";

type DeptLevel = "center" | "department" | "group";

// ===== 部门规范化映射表 =====

/** 组名 → 归属部门 */
const GROUP_TO_DEPT: Record<string, string> = {
  "产品一组": "产品部", "产品二组": "产品部",
  "ID设计组": "产品部", "结构设计组": "产品部", "项目管理": "产品部",
  "开发组": "IT部", "运维组": "IT部", "产品组": "IT部",
  "市场组": "经管部",
  "运营一部一组": "运营部", "运营一部二组": "运营部", "运营一部三组": "运营部",
  "运营一部四组": "运营部", "运营一部五组": "运营部",
  "运营二部一组": "运营部", "运营二部二组": "运营部", "运营二部三组": "运营部",
  "运营二部四组": "运营部", "运营二部五组": "运营部",
  "CPC广告": "运营部", "营销中心支持组": "运营部",
  "仓储组": "仓储物流部", "物流组": "仓储物流部",
};

/** 不规则部门名 → 标准部门名 */
const DEPT_RENAME: Record<string, string> = {
  "开发部": "产品部", "市场": "经管部", "开发组": "IT部",
  "产品一组": "产品部", "产品二组": "产品部",
  "物流组": "仓储物流部",
  "运营一部一组": "运营部", "运营一部二组": "运营部", "运营二部一组": "运营部",
  "运营一部": "运营部", "运营二部": "运营部",
  "营销中心-直属": "运营部", "计划物流中心": "仓储物流部",
  "未分配部门": "未分配",
};

/** 部门 → 中心归属补全（无中心时兜底） */
const DEPT_CENTER_FALLBACK: Record<string, string> = {
  "运营部": "营销中心",
  "经管部": "组织发展与赋能中心",
};

/** 用户级部门覆盖（飞书 open_id → 强制部门），优先级最高 */
const USER_DEPT_OVERRIDE: Record<string, { department: string; center_name?: string }> = {
  "ou_6af5ecae880f5e73d8bb9cf11b765b0d": { department: "运营部", center_name: "营销中心" }, // 刘雨 → 运营部
};

/** 硬编码管理员（飞书 open_id），同步时不会被降级 */
const HARDCODED_ADMIN_IDS = new Set([
  "ou_f2e284bb6701647e664c938806b08627", // 何广明
]);

/** 计算用户最终部门归属 */
function computeDepartment(groupName: string | null, department: string): string {
  // 1. 组名映射优先
  if (groupName && GROUP_TO_DEPT[groupName]) return GROUP_TO_DEPT[groupName];
  // 2. 部门名修正
  if (department && DEPT_RENAME[department]) return DEPT_RENAME[department];
  // 3. 保留原名（如果有效）
  if (department && department !== "未分配部门") return department;
  // 4. 无归属
  return "未分配";
}

// 全局同步状态（同一时间只有一个同步在跑）
let syncStatus: {
  running: boolean;
  startedAt?: number;
  finishedAt?: number;
  progress: string;
  result?: any;
  error?: string;
} = { running: false, progress: "idle" };

/**
 * GET /api/setup/sync-feishu → 查看同步状态
 * GET /api/setup/sync-feishu?run=1 → 启动后台同步，立即返回
 */
export async function GET(request: NextRequest) {
  const shouldRun = request.nextUrl.searchParams.get("run") === "1";

  if (!shouldRun) {
    return NextResponse.json(syncStatus);
  }

  if (syncStatus.running) {
    return NextResponse.json(
      { error: "同步已在运行中", status: syncStatus },
      { status: 409 }
    );
  }

  // 启动后台同步（不 await）
  runSyncInBackground();

  return NextResponse.json({
    message: "同步已在后台启动",
    status: syncStatus,
  }, { status: 202 });
}

/**
 * POST /api/setup/sync-feishu → 同步执行（适合 CLI 调用，长超时）
 */
export async function POST(request: NextRequest) {
  try {
    const result = await executeSync();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Sync] 同步失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "同步失败" },
      { status: 500 }
    );
  }
}

async function runSyncInBackground() {
  syncStatus = { running: true, startedAt: Date.now(), progress: "开始同步..." };
  try {
    const result = await executeSync();
    syncStatus = {
      running: false,
      startedAt: syncStatus.startedAt,
      finishedAt: Date.now(),
      progress: "完成",
      result,
    };
  } catch (error) {
    syncStatus = {
      running: false,
      startedAt: syncStatus.startedAt,
      finishedAt: Date.now(),
      progress: "失败",
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

async function executeSync() {
  const appToken = await getAppAccessToken();

  // ===== 1. Migration =====
  const { sqlite } = await getDb();
  const dbAny = sqlite as any;

  // 确保新表存在（同步不会 drop 表，只做增量）
  dbAny.exec(`CREATE TABLE IF NOT EXISTS alert_settings (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL,
    updated_by TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  const newCols = [
    ["group_name", "TEXT"],
    ["group_id", "TEXT"],
    ["center_name", "TEXT"],
    ["center_id", "TEXT"],
  ];
  for (const [col, type] of newCols) {
    try {
      dbAny.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
    } catch (e: any) {
      if (!e.message?.includes("duplicate column name")) {
        console.log(`[Sync] ALTER TABLE ${col}: ${e.message}`);
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
    } catch (e) {
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
    const existing = dbAny.exec(`SELECT id, api_key, role FROM users WHERE feishu_id = ?`, [openId]);
    const emailPrefix = user.email ? user.email.split("@")[0] : "user";

    if (existing.length > 0 && existing[0].values.length > 0) {
      const userId = existing[0].values[0][0];
      const existingApiKey = String(existing[0].values[0][1] || "");
      // 保留已有角色，仅确保管理员不丢失 admin 角色
      let existingRole = String(existing[0].values[0][2] || "member");
      if (adminIds.includes(openId) && !existingRole.split(",").map((r: string) => r.trim()).includes("admin")) {
        existingRole = existingRole === "member" ? "admin" : existingRole + ",admin";
      }
      if (!adminIds.includes(openId) && existingRole === "admin") {
        existingRole = "member";
      }
      // 如果 API Key 还是旧格式 sk-emp-，重新生成为 sk-{namePinyin}-xxx
      let newApiKey: string | null = null;
      if (existingApiKey.startsWith("sk-emp-")) {
        const namePinyin = pinyin(user.name || "", { toneType: "none", type: "array" }).join("").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "user";
        newApiKey = `sk-${namePinyin}-${randomBytes(6).toString("hex")}`;
        regeneratedKeys++;
      }
      if (newApiKey) {
        dbAny.exec(
          `UPDATE users SET name=?, avatar=?, email=?, department=?, department_id=?, group_name=?, group_id=?, center_name=?, center_id=?, employee_id=?, api_key=?, role=?, updated_at=? WHERE id=?`,
          [user.name, user.avatar_url || null, user.email, deptName, deptId, groupName, groupId, centerName, centerId, user.employee_no, newApiKey, existingRole, now, userId]
        );
      } else {
        dbAny.exec(
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
      dbAny.exec(
        `INSERT INTO users (id,feishu_id,name,avatar,email,department,department_id,group_name,group_id,center_name,center_id,employee_id,api_key,role,status,monthly_quota,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',200,?,?)`,
        [userId, openId, user.name, user.avatar_url || null, user.email, deptName, deptId, groupName, groupId, centerName, centerId, user.employee_no, apiKey, role, now, now]
      );
      created++;
    }
  }

  // ===== 5.5 部门规范化 + 中心归属补全 + 管理员保护 =====
  const normResult = dbAny.exec(`SELECT id, feishu_id, department, group_name, center_name, role FROM users`);
  let normalizedCount = 0;
  let centerFixedCount = 0;
  let adminProtectedCount = 0;
  if (normResult[0]?.values) {
    for (const r of normResult[0].values) {
      const uid = String(r[0]);
      const feishuId = String(r[1] || "");
      const rawDept = String(r[2] || "");
      const rawGroup = String(r[3] || "") || null;
      const rawCenter = String(r[4] || "") || null;
      const rawRole = String(r[5] || "member");

      // 用户级部门覆盖（最高优先级）
      const override = USER_DEPT_OVERRIDE[feishuId];
      if (override) {
        const newDept = override.department;
        const newCenter = override.center_name || rawCenter;
        if (newDept !== rawDept || newCenter !== rawCenter) {
          dbAny.exec(
            `UPDATE users SET department = ?, center_name = ? WHERE id = ?`,
            [newDept, newCenter, uid]
          );
          normalizedCount++;
          console.log(`[Sync] 用户级覆盖: ${feishuId} "${rawDept}" → "${newDept}"`);
        }
        // 用户级覆盖跳过后续部门规范化
        continue;
      }

      // 部门名规范化
      const newDept = computeDepartment(rawGroup, rawDept);
      const deptChanged = newDept !== rawDept;

      // 中心归属补全
      let newCenter = rawCenter;
      if (!newCenter && newDept) {
        const fallback = DEPT_CENTER_FALLBACK[newDept];
        if (fallback) {
          newCenter = fallback;
        }
      }
      const centerChanged = newCenter !== rawCenter;

      // 管理员保护：硬编码管理员的 admin 角色不会被同步降级
      let newRole = rawRole;
      if (HARDCODED_ADMIN_IDS.has(feishuId)) {
        const roles = rawRole.split(",").map((r: string) => r.trim()).filter(Boolean);
        if (!roles.includes("admin")) {
          roles.push("admin");
          newRole = roles.join(",");
        }
      }

      if (deptChanged || centerChanged || newRole !== rawRole) {
        dbAny.exec(
          `UPDATE users SET department = ?, center_name = ?, role = ? WHERE id = ?`,
          [newDept, newCenter, newRole, uid]
        );
        if (deptChanged) {
          normalizedCount++;
          console.log(`[Sync] 部门修正: "${rawDept}" → "${newDept}"`);
        }
        if (centerChanged) {
          centerFixedCount++;
          console.log(`[Sync] 中心补全: "${rawCenter || '(空)'}" → "${newCenter}"`);
        }
        if (newRole !== rawRole) {
          adminProtectedCount++;
          console.log(`[Sync] 管理员保护: feishu_id=${feishuId} → admin`);
        }
      }
    }
  }
  console.log(`[Sync] 规范化完成: 部门修正=${normalizedCount}, 中心补全=${centerFixedCount}, 管理员保护=${adminProtectedCount}`);

  // ===== 6. 清理种子假用户 =====
  // 飞书真实用户的 feishu_id 集合
  const realFeishuIds = new Set(userMap.keys());

  // 查找所有未被飞书匹配到的用户
  const allDbUsers = dbAny.exec(`SELECT id, feishu_id, name, department FROM users`);
  const seedUsers: { id: string; feishuId: string; name: string; dept: string }[] = [];
  if (allDbUsers[0]?.values) {
    for (const r of allDbUsers[0].values) {
      const fid = String(r[1] || "");
      if (!realFeishuIds.has(fid)) {
        seedUsers.push({ id: String(r[0]), feishuId: fid, name: String(r[2]), dept: String(r[3] || "") });
      }
    }
  }

  let cleanedCount = 0;
  let transferredLogs = 0;

  if (seedUsers.length > 0) {
    console.log(`[Sync] 发现 ${seedUsers.length} 个种子假用户，开始清理...`);

    // 获取所有真实用户列表（用于转移用量记录）
    const realUsers = dbAny.exec(`SELECT id, name, department FROM users WHERE feishu_id IN (${Array.from(realFeishuIds).map(() => "?").join(",")})`, Array.from(realFeishuIds));
    const realUserList: { id: string; name: string; dept: string }[] = [];
    if (realUsers[0]?.values) {
      for (const r of realUsers[0].values) {
        realUserList.push({ id: String(r[0]), name: String(r[1]), dept: String(r[2] || "") });
      }
    }

    for (const su of seedUsers) {
      // 把种子用户的 usage_logs 转移到同部门或随机真实用户
      const logsCount = dbAny.exec(`SELECT COUNT(*) FROM usage_logs WHERE user_id = ?`, [su.id]);
      const count = logsCount[0]?.values?.[0]?.[0] ? Number(logsCount[0].values[0][0]) : 0;

      if (count > 0 && realUserList.length > 0) {
        // 优先找同部门的真实用户
        let target = realUserList.find(ru => ru.dept === su.dept);
        if (!target) {
          // 随机选一个真实用户
          target = realUserList[Math.floor(Math.random() * realUserList.length)];
        }
        if (target) {
          dbAny.exec(`UPDATE usage_logs SET user_id = ? WHERE user_id = ?`, [target.id, su.id]);
          transferredLogs += count;
        }
      }

      // 删除种子用户
      dbAny.exec(`DELETE FROM quota_rules WHERE target_id = ?`, [su.id]);
      dbAny.exec(`DELETE FROM users WHERE id = ?`, [su.id]);
      cleanedCount++;
    }
  }

  await saveDb();

  // 输出明细
  console.log(`\n========== 同步结果明细 ==========`);
  const allResult = dbAny.exec(`SELECT name, center_name, department, group_name, email FROM users ORDER BY center_name, department, group_name`);
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
      cleanedSeedUsers: cleanedCount, transferredLogs, normalizedCount, centerFixedCount, adminProtectedCount,
    },
    summary: { centers: centers.map((d) => d.name), departments: departments.map((d) => d.name), groups: groups.map((d) => d.name) },
  };
}

/* ===== 辅助函数 ===== */

async function fetchDepartmentUsersRaw(appToken: string, departmentId: string) {
  const allUsers: any[] = [];
  let pageToken = "";
  do {
    const url = `${BASE_URL}/contact/v3/users?department_id=${departmentId}&department_id_type=department_id&user_id_type=open_id&page_size=50${pageToken ? `&page_token=${pageToken}` : ""}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${appToken}` } });
    const data = await resp.json();
    if (data.code !== 0) break;
    allUsers.push(...(data.data?.items || []));
    pageToken = data.data?.has_more ? data.data?.page_token : "";
  } while (pageToken);
  return allUsers;
}

async function fetchUserDetailRaw(appToken: string, openId: string) {
  try {
    const resp = await fetch(
      `${BASE_URL}/contact/v3/users/${openId}?user_id_type=open_id&department_id_type=department_id`,
      { headers: { Authorization: `Bearer ${appToken}` } }
    );
    const data = await resp.json();
    if (data.code !== 0) return null;
    return data.data?.user || null;
  } catch { return null; }
}
