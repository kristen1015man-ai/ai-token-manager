"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

/* ===== 颜色池 ===== */
const CHART_COLORS = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e", "#ef4444", "#f97316",
  "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1",
];

const CUSTOM_LABEL = [{ name: "费用占比", nameKey: "department", dataKey: "cost" }];

export default function DepartmentsPage() {
  const [data, setData] = useState<{ department: string; userCount: number; tokens: number; cost: number; avgCost: string }[]>([]);

  useEffect(() => {
    fetch(`/api/admin/departments?level=department`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setData(d?.departments || []));
  }, []);

  const pieData = data.map(d => ({ name: d.department, value: Math.round(Number(d.cost) * 100) / 100 }));
  const avgData = data.map(d => ({ department: d.department, avgCost: Number(d.avgCost) }));

  if (data.length === 0) {
    return (
      <div className="space-y-6">
        <h3 className="font-semibold text-gray-800 text-lg">部门用量排行</h3>
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <p>暂无数据</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="font-semibold text-gray-800 text-lg">部门用量排行</h3>

      {/* ===== 第一行：饼状图 + 人均柱状图 ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 饼状图 - 费用占比 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h4 className="font-semibold text-gray-800 mb-4">部门费用占比</h4>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => `¥${value.toFixed(2)}`}
                contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
              />
              <Legend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                iconType="circle"
                iconSize={8}
                formatter={(value: string) => <span style={{ fontSize: 11, color: "#666" }}>{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* 柱状图 - 人均费用 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h4 className="font-semibold text-gray-800 mb-4">人均费用排行</h4>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={avgData} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="#999" />
              <YAxis
                type="category"
                dataKey="department"
                tick={{ fontSize: 11 }}
                stroke="#999"
                width={80}
              />
              <Tooltip
                formatter={(value: number) => `¥${value.toFixed(2)}`}
                contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
              />
              <Bar dataKey="avgCost" radius={[0, 4, 4, 0]} name="人均费用(¥)">
                {avgData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ===== 第二行：总费用柱状图 ===== */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="font-semibold text-gray-800 mb-4">部门总费用排行</h4>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="department" tick={{ fontSize: 12 }} stroke="#999" />
            <YAxis tick={{ fontSize: 12 }} stroke="#999" />
            <Tooltip
              formatter={(value: number) => `¥${value.toFixed(2)}`}
              contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
            />
            <Bar dataKey="cost" radius={[4, 4, 0, 0]} name="费用(¥)">
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ===== 明细表格 ===== */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="font-semibold text-gray-800 mb-4">部门明细</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-gray-500">
              <th className="text-left py-2 font-medium">部门名称</th>
              <th className="text-right py-2 font-medium">人数</th>
              <th className="text-right py-2 font-medium">总费用</th>
              <th className="text-right py-2 font-medium">人均</th>
              <th className="text-right py-2 font-medium">Token数</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 font-medium text-gray-800">{d.department || "未分配"}</td>
                <td className="py-2 text-right text-gray-600">{d.userCount}</td>
                <td className="py-2 text-right font-medium text-gray-800">¥{Number(d.cost).toFixed(2)}</td>
                <td className="py-2 text-right text-gray-600">¥{d.avgCost}</td>
                <td className="py-2 text-right text-gray-600">{d.tokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
