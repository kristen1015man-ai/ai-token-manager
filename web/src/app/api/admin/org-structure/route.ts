import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb, type SqliteExec } from "../../../../lib/db";
import { apiHandler } from "../../../../lib/api-handler";

/**
 * 组织架构分析
 * 返回：
 * - tree: 完整树形结构（中心→部门→组→人员数量）
 * - edgeCases: 缺失部门级的人员列表
 * - stats: 各层级统计
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const { error } = await requireAdmin();
  if (error) return error;

  const { sqlite } = await getDb();
  const dbAny = sqlite as unknown as SqliteExec;

  // 确保列存在
  const colInfo = dbAny.exec(`PRAGMA table_info(users)`);
  const cols = new Set((colInfo[0]?.values ?? []).map((r: unknown[]) => String(r[1])));

  const hasCenter = cols.has("center_name");
  const hasGroup = cols.has("group_name");

  // 1. 所有用户及其三层架构
  const usersResult = dbAny.exec(`
    SELECT id, name, email, department, department_id,
           ${hasCenter ? "center_name, center_id," : ""}
           ${hasGroup ? "group_name, group_id" : ""}
    FROM users
    ORDER BY ${hasCenter ? "center_name," : ""} department, ${hasGroup ? "group_name" : "department"}
  `);

  type UserOrg = {
    id: string;
    name: string;
    email: string;
    department: string;
    departmentId: string;
    centerName: string;
    centerId: string;
    groupName: string;
    groupId: string;
  };

  // 解析用户数据
  const colNames = usersResult[0]?.columns ?? [];
  const allUsers: UserOrg[] = (usersResult[0]?.values ?? []).map((r: unknown[]) => {
    const row: Record<string, string> = {};
    colNames.forEach((c: string, i: number) => {
      row[c] = String(r[i] ?? "");
    });
    return {
      id: row["id"] || "",
      name: row["name"] || "",
      email: row["email"] || "",
      department: row["department"] || "",
      departmentId: row["department_id"] || "",
      centerName: row["center_name"] || "",
      centerId: row["center_id"] || "",
      groupName: row["group_name"] || "",
      groupId: row["group_id"] || "",
    };
  });

  // 2. 使用量数据（本月）
  const now = new Date();
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

  const usageResult = dbAny.exec(`
    SELECT u.id, SUM(ul.total_tokens) as tokens, SUM(ul.cost) as cost, COUNT(*) as calls
    FROM usage_logs ul
    JOIN users u ON ul.user_id = u.id
    WHERE ul.created_at >= ?
    GROUP BY u.id
  `, [monthStart]);

  const usageMap = new Map<string, { tokens: number; cost: number; calls: number }>();
  (usageResult[0]?.values ?? []).forEach((r: unknown[]) => {
    usageMap.set(String(r[0]), {
      tokens: Number(r[1]),
      cost: Number(r[2]),
      calls: Number(r[3]),
    });
  });

  // 3. 构建树形结构 + 聚合
  // 树: center → { departments: { deptName → { groups: { groupName → userCount } } } }
  interface GroupInfo {
    users: UserOrg[];
    totalTokens: number;
    totalCost: number;
    totalCalls: number;
  }
  interface DeptInfo {
    groups: Map<string, GroupInfo>;
    users: UserOrg[]; // 直接挂在部门下的人员（无组）
    totalTokens: number;
    totalCost: number;
    totalCalls: number;
  }
  interface CenterInfo {
    departments: Map<string, DeptInfo>;
    users: UserOrg[]; // 直接挂在中心下的人员（无部门）
    totalTokens: number;
    totalCost: number;
    totalCalls: number;
  }

  const tree = new Map<string, CenterInfo>();

  // 无归属人员
  const unassigned: UserOrg[] = [];

  // 无部门级的人员
  const noDeptUsers: UserOrg[] = [];

  // 无中心组的人员
  const noCenterUsers: UserOrg[] = [];

  function getUsage(uid: string) {
    return usageMap.get(uid) || { tokens: 0, cost: 0, calls: 0 };
  }

  for (const user of allUsers) {
    const usage = getUsage(user.id);
    const centerName = user.centerName || "未分配中心";
    const deptName = user.department || "";
    const groupName = user.groupName || "";

    // 检测异常：有中心组但没有部门级
    if (user.centerName && !user.department) {
      noDeptUsers.push(user);
    }

    // 检测异常：有部门但没有中心组
    if (user.department && !user.centerName) {
      noCenterUsers.push(user);
    }

    // 完全无归属
    if (!user.centerName && !user.department) {
      unassigned.push(user);
      continue;
    }

    // 构建树
    if (!tree.has(centerName)) {
      tree.set(centerName, {
        departments: new Map(),
        users: [],
        totalTokens: 0,
        totalCost: 0,
        totalCalls: 0,
      });
    }
    const center = tree.get(centerName)!;
    center.totalTokens += usage.tokens;
    center.totalCost += usage.cost;
    center.totalCalls += usage.calls;

    if (!deptName) {
      // 无部门，直接挂中心
      center.users.push(user);
      continue;
    }

    if (!center.departments.has(deptName)) {
      center.departments.set(deptName, {
        groups: new Map(),
        users: [],
        totalTokens: 0,
        totalCost: 0,
        totalCalls: 0,
      });
    }
    const dept = center.departments.get(deptName)!;
    dept.totalTokens += usage.tokens;
    dept.totalCost += usage.cost;
    dept.totalCalls += usage.calls;

    if (!groupName || groupName === "-") {
      // 无组，直接挂部门
      dept.users.push(user);
    } else {
      if (!dept.groups.has(groupName)) {
        dept.groups.set(groupName, {
          users: [],
          totalTokens: 0,
          totalCost: 0,
          totalCalls: 0,
        });
      }
      const group = dept.groups.get(groupName)!;
      group.users.push(user);
      group.totalTokens += usage.tokens;
      group.totalCost += usage.cost;
      group.totalCalls += usage.calls;
    }
  }

  // 4. 序列化树为 JSON
  const treeJson = Array.from(tree.entries()).map(([centerName, center]) => ({
    centerName,
    userCount: center.users.length,
    departmentCount: center.departments.size,
    groupCount: Array.from(center.departments.values()).reduce((sum, d) => sum + d.groups.size, 0),
    totalTokens: Math.round(center.totalTokens * 100) / 100,
    totalCost: Math.round(center.totalCost * 10000) / 10000,
    totalCalls: center.totalCalls,
    // 直接挂在中心下（无部门）
    directUsers: center.users.map(u => ({ id: u.id, name: u.name })),
    departments: Array.from(center.departments.entries()).map(([deptName, dept]) => ({
      departmentName: deptName,
      userCount: dept.users.length + Array.from(dept.groups.values()).reduce((s, g) => s + g.users.length, 0),
      groupCount: dept.groups.size,
      totalTokens: Math.round(dept.totalTokens * 100) / 100,
      totalCost: Math.round(dept.totalCost * 10000) / 10000,
      totalCalls: dept.totalCalls,
      // 直接挂在部门下（无组）
      directUsers: dept.users.map(u => ({ id: u.id, name: u.name })),
      groups: Array.from(dept.groups.entries()).map(([groupName, group]) => ({
        groupName,
        userCount: group.users.length,
        totalTokens: Math.round(group.totalTokens * 100) / 100,
        totalCost: Math.round(group.totalCost * 10000) / 10000,
        totalCalls: group.totalCalls,
        users: group.users.map(u => ({ id: u.id, name: u.name })),
      })),
    })),
  }));

  // 5. 全局统计
  const totalStats = {
    totalUsers: allUsers.length,
    withCenter: allUsers.filter(u => !!u.centerName).length,
    withDept: allUsers.filter(u => !!u.department).length,
    withGroup: allUsers.filter(u => !!u.groupName && u.groupName !== "-").length,
    noDeptUsers: noDeptUsers.length,
    noCenterUsers: noCenterUsers.length,
    unassigned: unassigned.length,
    centers: treeJson.length,
    departments: treeJson.reduce((s, c) => s + c.departments.length, 0),
    groups: treeJson.reduce((s, c) => s + c.departments.reduce((ss, d) => ss + d.groups.length, 0), 0),
  };

  return NextResponse.json({
    stats: totalStats,
    tree: treeJson,
    edgeCases: {
      noDeptUsers: noDeptUsers.map(u => ({
        id: u.id,
        name: u.name,
        centerName: u.centerName,
        groupName: u.groupName || "-",
      })),
      noCenterUsers: noCenterUsers.map(u => ({
        id: u.id,
        name: u.name,
        department: u.department,
      })),
      unassigned: unassigned.map(u => ({ id: u.id, name: u.name })),
    },
  });
});
