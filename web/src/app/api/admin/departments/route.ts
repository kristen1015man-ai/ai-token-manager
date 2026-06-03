import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getDb } from "../../../../lib/db";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const range = request.nextUrl.searchParams.get("range") || "month";
  const { sqlite } = await getDb();

  const now = new Date();
  let startTime: number;
  switch (range) {
    case "day":
      startTime = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
      break;
    case "week": {
      const dayOfWeek = now.getDay() || 7;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
      startTime = Math.floor(monday.getTime() / 1000);
      break;
    }
    case "year":
      startTime = Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
      break;
    default:
      startTime = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  }

  // 获取所有部门
  const deptResult = (sqlite as any).exec(`SELECT department_id, name, parent_id, level FROM departments ORDER BY level, name`);
  const deptRows = deptResult[0]?.values || [];

  // 获取每个部门ID的用量统计
  const usageResult = (sqlite as any).exec(`
    SELECT u.department_id,
      COUNT(DISTINCT u.id) as user_count,
      SUM(ul.cost) as total_cost,
      SUM(ul.total_tokens) as total_tokens,
      COUNT(*) as call_count
    FROM usage_logs ul
    JOIN users u ON ul.user_id = u.id
    WHERE ul.created_at >= ?
    GROUP BY u.department_id
  `, [startTime]);

  const usageMap: Record<string, { userCount: number; cost: number; tokens: number; calls: number }> = {};
  for (const row of usageResult[0]?.values || []) {
    usageMap[String(row[0])] = {
      userCount: Number(row[1]),
      cost: Number(row[2]),
      tokens: Number(row[3]),
      calls: Number(row[4]),
    };
  }

  // 获取每个部门的人数
  const countResult = (sqlite as any).exec(`SELECT department_id, COUNT(*) as cnt FROM users GROUP BY department_id`);
  const countMap: Record<string, number> = {};
  for (const row of countResult[0]?.values || []) {
    countMap[String(row[0])] = Number(row[1]);
  }

  // 构建部门节点
  interface DeptNode {
    id: string;
    name: string;
    parentId: string;
    level: number;
    memberCount: number;
    usage: { userCount: number; cost: number; tokens: number; calls: number };
    children: DeptNode[];
    totalCost?: number;
    totalTokens?: number;
    totalCalls?: number;
    totalMembers?: number;
    avgCost?: number;
  }

  const departments: DeptNode[] = deptRows.map((r: unknown[]) => ({
    id: String(r[0]),
    name: String(r[1]),
    parentId: String(r[2]),
    level: Number(r[3]),
    memberCount: countMap[String(r[0])] || 0,
    usage: usageMap[String(r[0])] || { userCount: 0, cost: 0, tokens: 0, calls: 0 },
    children: [],
  }));

  // 构建树形结构
  const deptMap: Record<string, DeptNode> = {};
  departments.forEach((d) => { deptMap[d.id] = d; });

  const tree: DeptNode[] = [];
  departments.forEach((d) => {
    if (d.parentId === "0" || !deptMap[d.parentId]) {
      tree.push(d);
    } else {
      deptMap[d.parentId].children.push(d);
    }
  });

  // 递归汇总子部门数据
  function aggregate(node: DeptNode): { cost: number; tokens: number; calls: number; memberCount: number } {
    let total = {
      cost: node.usage.cost,
      tokens: node.usage.tokens,
      calls: node.usage.calls,
      memberCount: node.memberCount,
    };
    for (const child of node.children) {
      const childTotal = aggregate(child);
      total.cost += childTotal.cost;
      total.tokens += childTotal.tokens;
      total.calls += childTotal.calls;
      total.memberCount += childTotal.memberCount;
    }
    node.totalCost = Math.round(total.cost * 100) / 100;
    node.totalTokens = total.tokens;
    node.totalCalls = total.calls;
    node.totalMembers = total.memberCount;
    node.avgCost = total.memberCount > 0 ? Math.round(total.cost / total.memberCount * 100) / 100 : 0;
    return total;
  }
  tree.forEach(aggregate);

  return NextResponse.json({ departments: tree });
}
