import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, saveDb, resetDb } from "../../../../lib/db";

// 与 cleanup-preview 相同的映射
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

const DEPT_RENAME: Record<string, string> = {
  "开发部": "产品部", "市场": "经管部", "开发组": "IT部",
  "产品一组": "产品部", "产品二组": "产品部",
  "物流组": "仓储物流部",
  "运营一部一组": "运营部", "运营一部二组": "运营部", "运营二部一组": "运营部",
  "运营一部": "运营部", "运营二部": "运营部",
  "营销中心-直属": "运营部", "计划物流中心": "仓储物流部",
  "未分配部门": "未分配",
};

function computeDept(groupName: string, department: string, centerName: string): string {
  // 1. 组 → 部门映射优先
  if (groupName && groupName !== "-" && GROUP_TO_DEPT[groupName]) {
    return GROUP_TO_DEPT[groupName];
  }
  // 2. 部门名修正
  if (department && DEPT_RENAME[department]) {
    return DEPT_RENAME[department];
  }
  // 3. 直接使用部门名
  if (department && department !== "未分配部门") {
    return department;
  }
  // 4. 无部门，挂中心直属
  if (centerName && centerName !== "未分配中心") {
    return centerName + "-直属";
  }
  // 5. 完全无归属
  return "未分配";
}

export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { sqlite } = await getDb();
  const dbAny = sqlite as any;

  // 读取所有用户
  const result = dbAny.exec(`
    SELECT id, feishu_id, name, department, group_name, center_name
    FROM users
  `);
  const cols = result[0]?.columns ?? [];
  const rows = result[0]?.values ?? [];

  interface UserRecord {
    id: string; feishu_id: string; name: string;
    department: string; group_name: string; center_name: string;
    newDept: string;
  }

  const users: UserRecord[] = rows.map((r: unknown[]) => {
    const row: Record<string, string> = {};
    cols.forEach((c: string, i: number) => { row[c] = String(r[i] ?? ""); });
    return {
      id: row["id"],
      feishu_id: row["feishu_id"],
      name: row["name"],
      department: row["department"],
      group_name: row["group_name"],
      center_name: row["center_name"],
      newDept: computeDept(row["group_name"] || "", row["department"] || "", row["center_name"] || ""),
    };
  });

  let updatedCount = 0;
  let deletedCount = 0;
  const changes: string[] = [];

  // Step 1: 更新所有用户的 department
  for (const u of users) {
    if (u.department !== u.newDept) {
      dbAny.exec(`UPDATE users SET department = ? WHERE id = ?`, [u.newDept, u.id]);
      changes.push(`${u.name}: "${u.department}" → "${u.newDept}"`);
      updatedCount++;
    }
  }

  // Step 2: 去重 — 同一部门下同名人，保留有 feishu_id 的
  const deptNameGroups = new Map<string, UserRecord[]>();
  for (const u of users) {
    const key = `${u.name}|${u.newDept}`;
    if (!deptNameGroups.has(key)) deptNameGroups.set(key, []);
    deptNameGroups.get(key)!.push(u);
  }

  for (const [key, group] of deptNameGroups) {
    if (group.length <= 1) continue;

    // 排序：有 feishu_id 的排前面，id 短的排前面（seed user id format: u_xxx）
    group.sort((a, b) => {
      if (!!a.feishu_id !== !!b.feishu_id) return a.feishu_id ? -1 : 1;
      return a.id.length - b.id.length;
    });

    const keep = group[0];
    for (let i = 1; i < group.length; i++) {
      const dup = group[i];
      // 把 dup 的 usage_logs 转移到 keep
      dbAny.exec(`UPDATE usage_logs SET user_id = ? WHERE user_id = ?`, [keep.id, dup.id]);
      // 删除重复用户
      dbAny.exec(`DELETE FROM users WHERE id = ?`, [dup.id]);
      changes.push(`去重: ${dup.name}(${dup.id}) → 合并到 ${keep.id}`);
      deletedCount++;
    }
  }

  await saveDb();
  resetDb();

  return NextResponse.json({
    success: true,
    updatedCount,
    deletedCount,
    totalUsers: users.length - deletedCount,
    changes: changes.slice(0, 100), // 只返回前100条变更
    changeCount: changes.length,
  });
}
