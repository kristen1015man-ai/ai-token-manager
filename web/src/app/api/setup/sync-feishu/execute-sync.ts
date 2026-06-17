import { randomBytes } from "crypto";
import { pinyin } from "pinyin-pro";
import { getDb, saveDb, getRawExec } from "../../../../lib/db";
import { getAppAccessToken, fetchAllDepartmentsWithParent } from "../../../../lib/feishu";
import { ensureDecrypted, ensureEncrypted, searchableHash } from "../../../../lib/crypto";
import { type DeptLevel } from "./constants";
import { fetchDepartmentUsersRaw, fetchUserDetailRaw } from "./api-helpers";
import { normalizeAndProtect } from "./normalize";
import { cleanupDepartedAndSeed } from "./cleanup";

export interface SyncResult {
  success: boolean;
  message: string;
  stats: {
    totalDepartments: number;
    centers: number;
    departments: number;
    groups: number;
    totalUsers: number;
    created: number;
    updated: number;
    reactivated: number;
    regeneratedKeys: number;
    cleanedSeedUsers: number;
    transferredLogs: number;
    normalizedCount: number;
    centerFixedCount: number;
    adminProtectedCount: number;
    disabledDeparted: number;
    departedCandidates: number;
    skippedDeparted: number;
    failedDepartments: number;
  };
  summary: { centers: string[]; departments: string[]; groups: string[] };
}

interface SyncedUser {
  open_id: string;
  name: string;
  email: string;
  avatar_url: string;
  employee_no: string;
  deptIds: string[];
}

function classifyDept(_id: string, name: string, depth: number): DeptLevel {
  if (name.endsWith("中心")) return "center";
  if (name.endsWith("组")) return "group";
  if (name.endsWith("部")) return "department";
  if (depth <= 1) return "center";
  if (depth === 2) return "department";
  return "group";
}

function readMaxAutoDisableDeparted(): number {
  const parsed = Number(process.env.FEISHU_MAX_AUTO_DISABLE_DEPARTED ?? 5);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
}

export async function executeSync(): Promise<SyncResult> {
  const appToken = await getAppAccessToken();
  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);

  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  const newCols: Array<[string, string]> = [
    ["group_name", "TEXT"],
    ["group_id", "TEXT"],
    ["center_name", "TEXT"],
    ["center_id", "TEXT"],
  ];
  for (const [col, type] of newCols) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("duplicate column name")) {
        console.log(`[Sync] ALTER TABLE ${col}: ${msg}`);
      }
    }
  }

  const allDepts = await fetchAllDepartmentsWithParent(appToken);
  console.log(`[Sync] fetched ${allDepts.length} departments`);

  const deptMap = new Map<string, (typeof allDepts)[number]>();
  for (const d of allDepts) deptMap.set(d.department_id, d);

  const depthCache = new Map<string, number>();
  function calcDepth(id: string): number {
    if (id === "0" || !id) return 0;
    if (depthCache.has(id)) return depthCache.get(id)!;
    const dept = deptMap.get(id);
    if (!dept) return 1;
    const depth = calcDepth(dept.parent_department_id) + 1;
    depthCache.set(id, depth);
    return depth;
  }

  const deptLevel = new Map<string, DeptLevel>();
  for (const d of allDepts) {
    const depth = calcDepth(d.department_id);
    const level = classifyDept(d.department_id, d.name, depth);
    deptLevel.set(d.department_id, level);
    console.log(`[Sync] dept: ${d.name} (depth=${depth}, level=${level})`);
  }

  const centers = allDepts.filter((d) => deptLevel.get(d.department_id) === "center");
  const departments = allDepts.filter((d) => deptLevel.get(d.department_id) === "department");
  const groups = allDepts.filter((d) => deptLevel.get(d.department_id) === "group");
  console.log(`[Sync] department levels: centers=${centers.length}, departments=${departments.length}, groups=${groups.length}`);

  const activeBeforeResult = db.exec(`SELECT COUNT(*) FROM users WHERE status = 'active' AND feishu_id LIKE 'ou_%'`);
  const activeBeforeCount = Number(activeBeforeResult[0]?.values?.[0]?.[0] ?? 0);
  const userMap = new Map<string, SyncedUser>();
  const failedDepartmentFetches: Array<{ id: string; name: string; error: string }> = [];

  for (const dept of allDepts) {
    try {
      const deptUsers = await fetchDepartmentUsersRaw(appToken, dept.department_id);
      for (const u of deptUsers) {
        const openId = u.open_id || "";
        if (!openId || userMap.has(openId)) continue;
        const detail = await fetchUserDetailRaw(appToken, openId);
        userMap.set(openId, {
          open_id: openId,
          name: detail?.name || u.name || `user_${userMap.size + 1}`,
          email: detail?.email || detail?.enterprise_email || "",
          avatar_url: detail?.avatar?.avatar_240 || "",
          employee_no: detail?.employee_no || "",
          deptIds: detail?.department_ids || [],
        });
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failedDepartmentFetches.push({ id: dept.department_id, name: dept.name, error });
      console.warn(`[Sync] Department user fetch failed: ${dept.name} (${dept.department_id}) - ${error}`);
    }
  }
  console.log(`[Sync] deduplicated users: ${userMap.size}`);

  const adminIds = (process.env.ADMIN_IDS || "").split(",").map((e) => e.trim()).filter(Boolean);
  const now = Math.floor(Date.now() / 1000);
  let created = 0;
  let updated = 0;
  let reactivated = 0;
  let regeneratedKeys = 0;

  for (const [openId, user] of userMap) {
    const userCenters: Array<{ id: string; name: string }> = [];
    const userDepts: Array<{ id: string; name: string }> = [];
    const userGroups: Array<{ id: string; name: string }> = [];

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
    const groupName = userGroups[0]?.name || null;
    const groupId = userGroups[0]?.id || null;

    if (!deptName) {
      if (groupName && groupId) {
        const groupDept = deptMap.get(groupId);
        const parentId = groupDept?.parent_department_id;
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
      if (!deptName && centerId) {
        for (const d of allDepts) {
          if (d.parent_department_id === centerId && deptLevel.get(d.department_id) === "department") {
            deptName = d.name;
            deptId = d.department_id;
            break;
          }
        }
      }
      if (!deptName) {
        deptName = centerName ? `${centerName}-直属` : "未分配部门";
        deptId = centerId || "unassigned";
      }
    }

    if (!centerName && deptId) {
      const deptObj = deptMap.get(deptId);
      const parentId = deptObj?.parent_department_id;
      if (parentId && deptLevel.get(parentId) === "center") {
        const parentDept = deptMap.get(parentId);
        centerName = parentDept?.name || null;
        centerId = parentId;
      }
    }

    const existing = db.exec(`SELECT id, api_key, api_key_hash, role, status FROM users WHERE feishu_id = ?`, [openId]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      const row = existing[0].values[0];
      const userId = String(row[0]);
      const existingApiKey = String(row[1] || "");
      const existingApiKeyHash = String(row[2] || "");
      let existingRole = String(row[3] || "member");
      const existingStatus = String(row[4] || "active");

      if (existingStatus !== "active") reactivated++;
      if (adminIds.includes(openId) && !existingRole.split(",").map((r) => r.trim()).includes("admin")) {
        existingRole = existingRole === "member" ? "admin" : `${existingRole},admin`;
      }
      if (!adminIds.includes(openId) && existingRole === "admin") existingRole = "member";

      const decryptedExistingKey = ensureDecrypted(existingApiKey);
      let keyToPersist: string | null = null;
      let hashToPersist: string | null = null;
      if (!decryptedExistingKey) {
        const namePinyin = pinyin(user.name || "", { toneType: "none", type: "array" })
          .join("")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 16) || "user";
        const newApiKey = `sk-emp-${namePinyin}-${randomBytes(16).toString("hex")}`;
        keyToPersist = ensureEncrypted(newApiKey);
        hashToPersist = searchableHash(newApiKey);
        regeneratedKeys++;
      } else if (!decryptedExistingKey.startsWith("enc:v1:")) {
        const expectedHash = searchableHash(decryptedExistingKey);
        if (existingApiKeyHash !== expectedHash) hashToPersist = expectedHash;
      } else if (!existingApiKeyHash) {
        console.warn(`[Sync] User ${user.name} API key cannot be decrypted; keeping original value without hash backfill`);
      }

      db.exec(
        `UPDATE users
         SET name=?, avatar=?, email=?, department=?, department_id=?, group_name=?, group_id=?,
             center_name=?, center_id=?, employee_id=?, api_key=COALESCE(?, api_key),
             api_key_hash=COALESCE(?, api_key_hash), role=?, status='active', updated_at=?
         WHERE id=?`,
        [
          user.name,
          user.avatar_url || null,
          user.email,
          deptName,
          deptId,
          groupName,
          groupId,
          centerName,
          centerId,
          user.employee_no,
          keyToPersist,
          hashToPersist,
          existingRole,
          now,
          userId,
        ]
      );
      updated++;
    } else {
      const userId = randomBytes(8).toString("hex");
      const namePinyin = pinyin(user.name || "", { toneType: "none", type: "array" })
        .join("")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 16) || "user";
      const apiKey = `sk-emp-${namePinyin}-${randomBytes(16).toString("hex")}`;
      const role = adminIds.includes(openId) ? "admin" : "member";
      db.exec(
        `INSERT INTO users
         (id,feishu_id,name,avatar,email,department,department_id,group_name,group_id,
          center_name,center_id,employee_id,api_key,api_key_hash,role,status,monthly_quota,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',200,?,?)`,
        [
          userId,
          openId,
          user.name,
          user.avatar_url || null,
          user.email,
          deptName,
          deptId,
          groupName,
          groupId,
          centerName,
          centerId,
          user.employee_no,
          ensureEncrypted(apiKey),
          searchableHash(apiKey),
          role,
          now,
          now,
        ]
      );
      created++;
    }
  }

  const { normalizedCount, centerFixedCount, adminProtectedCount } = await normalizeAndProtect(db);

  const realFeishuIds = new Set(userMap.keys());
  const maxAutoDisableDeparted = readMaxAutoDisableDeparted();
  const missingComparedToActive = Math.max(0, activeBeforeCount - userMap.size);
  const skipReasons: string[] = [];
  if (failedDepartmentFetches.length > 0) skipReasons.push(`${failedDepartmentFetches.length} department fetches failed`);
  if (missingComparedToActive > maxAutoDisableDeparted) {
    skipReasons.push(`fetched users dropped by ${missingComparedToActive}, max auto-disable is ${maxAutoDisableDeparted}`);
  }

  const cleanup = await cleanupDepartedAndSeed(db, realFeishuIds, adminIds, now, {
    allowDepartedDisable: skipReasons.length === 0,
    skipDepartedReason: skipReasons.join("; "),
    maxAutoDisableDeparted,
  });

  await saveDb();

  console.log(
    `[Sync] complete: users=${userMap.size}, created=${created}, updated=${updated}, ` +
    `reactivated=${reactivated}, departedCandidates=${cleanup.departedCandidates}, ` +
    `disabledDeparted=${cleanup.disabledDeparted}, skippedDeparted=${cleanup.skippedDeparted}, ` +
    `failedDepartments=${failedDepartmentFetches.length}`
  );

  return {
    success: true,
    message: "飞书通讯录同步完成",
    stats: {
      totalDepartments: allDepts.length,
      centers: centers.length,
      departments: departments.length,
      groups: groups.length,
      totalUsers: userMap.size,
      created,
      updated,
      reactivated,
      regeneratedKeys,
      cleanedSeedUsers: cleanup.cleanedSeedUsers,
      transferredLogs: cleanup.transferredLogs,
      normalizedCount,
      centerFixedCount,
      adminProtectedCount,
      disabledDeparted: cleanup.disabledDeparted,
      departedCandidates: cleanup.departedCandidates,
      skippedDeparted: cleanup.skippedDeparted,
      failedDepartments: failedDepartmentFetches.length,
    },
    summary: {
      centers: centers.map((d) => d.name),
      departments: departments.map((d) => d.name),
      groups: groups.map((d) => d.name),
    },
  };
}
