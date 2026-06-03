"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface DeptNode {
  id: string;
  name: string;
  parentId: string;
  level: number;
  memberCount: number;
  totalCost?: number;
  totalTokens?: number;
  totalCalls?: number;
  totalMembers?: number;
  avgCost?: number;
  children: DeptNode[];
}

const RANGE_OPTIONS = [
  { value: "day", label: "今日" },
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "year", label: "今年" },
];

/* 层级标签 */
function LevelBadge({ level }: { level: number }) {
  const styles = [
    "bg-indigo-100 text-indigo-700 border-indigo-200", // 中心
    "bg-blue-100 text-blue-700 border-blue-200",       // 部门
    "bg-gray-100 text-gray-600 border-gray-200",       // 组
  ];
  const labels = ["中心", "部门", "组"];
  const s = styles[level] || styles[2];
  const l = labels[level] || "组";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${s}`}>{l}</span>;
}

/* 树形行组件 */
function DeptRow({ node, depth = 0 }: { node: DeptNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <>
      <tr className={`border-b border-gray-50 hover:bg-gray-50/80 transition-colors ${depth === 0 ? "bg-gray-50/40" : ""}`}>
        <td className="py-3 px-4">
          <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 24}px` }}>
            {hasChildren ? (
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-200 text-gray-400 transition-colors text-xs"
              >
                {expanded ? "▼" : "▶"}
              </button>
            ) : (
              <span className="w-5" />
            )}
            <span className={`font-medium ${depth === 0 ? "text-gray-900" : depth === 1 ? "text-gray-800" : "text-gray-700"}`}>
              {node.name}
            </span>
            <LevelBadge level={node.level} />
          </div>
        </td>
        <td className="py-3 px-4 text-right text-gray-600">{node.totalMembers || 0}</td>
        <td className="py-3 px-4 text-right font-medium text-gray-800">¥{(node.totalCost || 0).toFixed(2)}</td>
        <td className="py-3 px-4 text-right text-gray-600">¥{(node.avgCost || 0).toFixed(2)}</td>
        <td className="py-3 px-4 text-right text-gray-600">{(node.totalTokens || 0).toLocaleString()}</td>
        <td className="py-3 px-4 text-right text-gray-600">{(node.totalCalls || 0).toLocaleString()}</td>
      </tr>
      {expanded && hasChildren && node.children.map((child) => (
        <DeptRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function DepartmentsPage() {
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [range, setRange] = useState("month");

  useEffect(() => {
    fetch(`/api/admin/departments?range=${range}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setTree(d?.departments || []));
  }, [range]);

  // 柱状图数据（仅顶层中心）
  const chartData = tree.map((d) => ({
    name: d.name.replace(/中心$/, ""),
    cost: d.totalCost || 0,
  }));

  return (
    <div className="space-y-6">
      {/* 筛选栏 */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 text-lg">组织架构概览</h3>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                range === opt.value ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 柱状图 */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h4 className="text-sm font-medium text-gray-600 mb-4">各中心费用对比</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#999" />
              <YAxis tick={{ fontSize: 12 }} stroke="#999" />
              <Tooltip contentStyle={{ borderRadius: "8px", fontSize: "12px" }} />
              <Bar dataKey="cost" fill="#6366f1" radius={[4, 4, 0, 0]} name="费用(¥)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 三层树形表格 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 font-medium text-gray-500 min-w-[240px]">部门</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">人数</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">总费用</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">人均</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Token</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">调用次数</th>
            </tr>
          </thead>
          <tbody>
            {tree.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center text-gray-400">
                  <div className="text-3xl mb-2">📊</div>暂无数据
                </td>
              </tr>
            ) : (
              tree.map((node) => (
                <DeptRow key={node.id} node={node} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
