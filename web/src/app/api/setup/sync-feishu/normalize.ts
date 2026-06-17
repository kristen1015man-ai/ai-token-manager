import { type SqliteExec } from "../../../../lib/db";
import {
  USER_DEPT_OVERRIDE,
  DEPT_CENTER_FALLBACK,
  HARDCODED_ADMIN_IDS,
  computeDepartment,
} from "./constants";

/**
 * 部门规范化 + 中心归属补全 + 管理员保护
 * 从 executeSync 的步骤 5.5 提取。
 */
export async function normalizeAndProtect(db: SqliteExec): Promise<{
  normalizedCount: number;
  centerFixedCount: number;
  adminProtectedCount: number;
}> {
  const normResult = db.exec(`SELECT id, feishu_id, department, group_name, center_name, role FROM users`);
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
          db.exec(
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
        const roles = rawRole.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (!roles.includes("admin")) {
          roles.push("admin");
          newRole = roles.join(",");
        }
      }

      if (deptChanged || centerChanged || newRole !== rawRole) {
        db.exec(
          `UPDATE users SET department = ?, center_name = ?, role = ? WHERE id = ?`,
          [newDept, newCenter, newRole, uid]
        );
        if (deptChanged) {
          normalizedCount++;
          console.log(`[Sync] 部门修正: "${rawDept}" → "${newDept}"`);
        }
        if (centerChanged) {
          centerFixedCount++;
          console.log(`[Sync] 中心补全: "${rawCenter || "(空)"}" → "${newCenter}"`);
        }
        if (newRole !== rawRole) {
          adminProtectedCount++;
          console.log(`[Sync] 管理员保护: feishu_id=${feishuId} → admin`);
        }
      }
    }
  }

  console.log(`[Sync] 规范化完成: 部门修正=${normalizedCount}, 中心补全=${centerFixedCount}, 管理员保护=${adminProtectedCount}`);

  return { normalizedCount, centerFixedCount, adminProtectedCount };
}
