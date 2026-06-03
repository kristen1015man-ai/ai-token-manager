import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";

/**
 * 部门级数据清洗预览
 * - 组级向上匹配到部门级
 * - 去重（同一飞书ID只保留一条）
 * - 列出无部门的人员
 * - 不修改数据库，只预览
 */

// 组 → 部门 映射
const GROUP_TO_DEPT: Record<string, string> = {
  // 产品线
  "产品一组": "产品部",
  "产品二组": "产品部",
  "ID设计组": "产品部",
  "结构设计组": "产品部",
  "项目管理": "产品部",
  // IT线
  "开发组": "IT部",
  "运维组": "IT部",
  "产品组": "IT部",
  // 经管线
  "市场组": "经管部",
  // 运营线 (全部归运营部)
  "运营一部一组": "运营部",
  "运营一部二组": "运营部",
  "运营一部三组": "运营部",
  "运营一部四组": "运营部",
  "运营一部五组": "运营部",
  "运营二部一组": "运营部",
  "运营二部二组": "运营部",
  "运营二部三组": "运营部",
  "运营二部四组": "运营部",
  "运营二部五组": "运营部",
  "CPC广告": "运营部",
  "营销中心支持组": "运营部",
  // 仓储物流
  "仓储组": "仓储物流部",
  "物流组": "仓储物流部",
};

// 部门名修正 (假部门 → 真部门)
const DEPT_RENAME: Record<string, string> = {
  "开发部": "产品部",
  "市场": "经管部",
  "开发组": "IT部",
  "产品一组": "产品部",
  "产品二组": "产品部",
  "物流组": "仓储物流部",
  "运营一部一组": "运营部",
  "运营一部二组": "运营部",
  "运营二部一组": "运营部",
  "运营一部": "运营部",
  "运营二部": "运营部",
  "营销中心-直属": "运营部",
  "计划物流中心": "计划物流中心-直属",
  "未分配部门": "未分配",
};

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const { sqlite } = await getDb();
  const dbAny = sqlite as any;

  // 查所有用户
  const result = dbAny.exec(`
    SELECT id, feishu_id, name, email, department, group_name, center_name, role
    FROM users
    ORDER BY center_name, department, group_name, name
  `);

  const cols = result[0]?.columns ?? [];
  const allUsers = (result[0]?.values ?? []).map((r: unknown[]) => {
    const row: Record<string, string> = {};
    cols.forEach((c: string, i: number) => { row[c] = String(r[i] ?? ""); });
    return row;
  });

  // 去重：按 feishu_id 取 org 信息最完整的那条
  const seen = new Map<string, typeof allUsers[0]>();
  for (const u of allUsers) {
    const fid = u["feishu_id"];
    if (!fid) continue;
    const existing = seen.get(fid);
    if (!existing) {
      seen.set(fid, u);
    } else {
      // 保留 center_name 不为空的那条（更喜欢飞书同步数据）
      const curCenter = u["center_name"] || "";
      const existCenter = existing["center_name"] || "";
      if (curCenter && !existCenter) {
        seen.set(fid, u);
      }
    }
  }

  interface DetailRow {
    name: string;
    email: string;
    role: string;
    originalDept: string;
    originalGroup: string;
    originalCenter: string;
    finalDept: string;
    reason: string;
    hasIssue: boolean;
    issueNote: string;
  }

  const details: DetailRow[] = [];
  let noDeptCount = 0;
  let conflictCount = 0;

  for (const [_fid, u] of seen) {
    const name = u["name"];
    const email = u["email"];
    const role = u["role"];
    const origDept = u["department"];
    const origGroup = u["group_name"];
    const origCenter = u["center_name"];
    let finalDept = "";
    let reason = "";
    let issueNote = "";
    let hasIssue = false;

    // Step 1: 如果 group_name 在映射表中 → 用映射结果
    if (origGroup && GROUP_TO_DEPT[origGroup]) {
      finalDept = GROUP_TO_DEPT[origGroup];
      reason = `组"${origGroup}" → "${finalDept}"`;
    }
    // Step 2: 如果 department 是已知的组名 → 修正为部门名
    else if (origDept && DEPT_RENAME[origDept]) {
      finalDept = DEPT_RENAME[origDept];
      reason = `部门名修正: "${origDept}" → "${finalDept}"`;
    }
    // Step 3: 如果 department 是组名（以"组"结尾）→ 尝试匹配
    else if (origDept && origDept.endsWith("组") && GROUP_TO_DEPT[origDept]) {
      finalDept = GROUP_TO_DEPT[origDept];
      reason = `部门名是组级"${origDept}" → "${finalDept}"`;
    }
    // Step 4: department 已有，直接使用
    else if (origDept && origDept !== "未分配部门") {
      finalDept = origDept;
      reason = "直接使用部门";
    }
    // Step 5: 没有部门 → 如果有中心则挂中心-直属，否则标记异常
    else if (!origDept || origDept === "未分配部门") {
      if (origCenter && origCenter !== "未分配中心") {
        finalDept = origCenter + "-直属";
        reason = "无部门，挂中心直属";
        hasIssue = true;
        issueNote = "挂中心直属";
      } else {
        finalDept = "未分配";
        reason = "无部门无中心";
        hasIssue = true;
        issueNote = "完全无归属";
        noDeptCount++;
      }
    }
    // fallback
    else {
      finalDept = origDept;
      reason = "fallback";
    }

    // 检查是否有冲突：group 和 department 同时存在且都指向不同部门
    if (origGroup && origDept && origGroup !== "-" && origDept !== "未分配部门") {
      const groupDept = GROUP_TO_DEPT[origGroup];
      if (groupDept && groupDept !== origDept && !DEPT_RENAME[origDept]) {
        issueNote = issueNote ? issueNote + "; 组部门冲突" : "组部门冲突";
        hasIssue = true;
        conflictCount++;
      }
    }

    details.push({
      name,
      email,
      role,
      originalDept: origDept || "(空)",
      originalGroup: origGroup || "(空)",
      originalCenter: origCenter || "(空)",
      finalDept,
      reason,
      hasIssue,
      issueNote,
    });
  }

  // 排序：有问题排前面，然后按最终部门排序
  details.sort((a, b) => {
    if (a.hasIssue !== b.hasIssue) return a.hasIssue ? -1 : 1;
    return a.finalDept.localeCompare(b.finalDept);
  });

  // 按最终部门分组统计
  const deptStats = new Map<string, number>();
  for (const d of details) {
    deptStats.set(d.finalDept, (deptStats.get(d.finalDept) || 0) + 1);
  }

  return NextResponse.json({
    total: details.length,
    noDeptCount,
    conflictCount,
    departmentCount: deptStats.size,
    departmentStats: Object.fromEntries(
      Array.from(deptStats.entries()).sort((a, b) => b[1] - a[1])
    ),
    details,
  });
}
