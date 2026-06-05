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

/* ===== 饼图中心标签 ===== */
function PieCenterLabel({ totalCost }: { totalCost: number }) {
  return (
    <text x="50%" y="45%" textAnchor="middle" dominantBaseline="central" fill="#1f2937">
      <tspan fontSize="14" fontWeight="600">总费用</tspan>
      <tspan x="50%" dy="24" fontSize="18" fontWeight="700" fill="#4f46e5">¥{totalCost.toFixed(2)}</tspan>
    </text>
  );
}

/* ===== 自定义饼图标签（扇区外显示名称+百分比+金额） ===== */
const RADIAN = Math.PI / 180;
function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name, value }: any) {
  const radius = outerRadius + 35;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  // 如果占比太小(<5%)，不显示标签避免重叠
  if (percent < 0.04) return null;

  return (
    <g>
      <text x={x} y={y - 6} textAnchor={x > cx ? "start" : "end"} fill="#374151" fontSize="11" fontWeight="600">
        {name}
      </text>
      <text x={x} y={y + 8} textAnchor={x > cx ? "start" : "end"} fill="#6b7280" fontSize="10">
        ¥{Number(value).toFixed(2)} · {(percent * 100).toFixed(1)}%
      </text>
    </g>
  );
}

export default function BillingPage() {
  const [departments, setDepartments] = useState<{ department: string; userCount: number; tokens: number; cost: number; avgCost: string }[]>([]);
  const [range, setRange] = useState("month");

  useEffect(() => {
    fetch(`/api/admin/departments?level=department&range=${range}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setDepartments(d?.departments || []));
  }, [range]);

  const handleExport = () => {
    window.open("/api/admin/export", "_blank");
  };

  const totalCost = departments.reduce((s, d) => s + Number(d.cost), 0);

  const pieData = departments.map(d => ({
    name: d.department || "未分配",
    value: Math.round(Number(d.cost) * 100) / 100,
  }));

  const avgData = departments
    .map(d => ({ department: d.department || "未分配", avgCost: Number(d.avgCost) }))
    .sort((a, b) => b.avgCost - a.avgCost);

  const RANGE_OPTIONS = [
    { value: "day", label: "今日" },
    { value: "week", label: "本周" },
    { value: "month", label: "本月" },
    { value: "year", label: "今年" },
  ];

  return (
    <div className="space-y-6">
      {/* 头部：总费用 + 筛选 + 导出 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-gray-500">本月总费用</p>
          <p className="text-3xl font-bold text-gray-900">¥{totalCost.toFixed(2)}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
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
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            📥 导出 CSV
          </button>
        </div>
      </div>

      {departments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <p>暂无数据</p>
        </div>
      ) : (
        <>
          {/* ===== 图表行：饼图 + 人均柱状图 ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 饼状图 - 费用占比 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h4 className="font-semibold text-gray-800 mb-4">部门费用占比</h4>
              <ResponsiveContainer width="100%" height={360}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    paddingAngle={2}
                    dataKey="value"
                    labelLine={false}
                    label={renderCustomLabel}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [`¥${Number(value).toFixed(2)}`, "费用"] as any}
                    contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    iconType="circle"
                    iconSize={8}
                    formatter={(value: string, entry: any) => {
                      const item = pieData.find(d => d.name === value);
                      const pct = item && totalCost > 0 ? ((item.value / totalCost) * 100).toFixed(1) : "0";
                      return <span style={{ fontSize: 11, color: "#666" }}>{value} ({pct}%)</span>;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* 柱状图 - 人均费用排行 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h4 className="font-semibold text-gray-800 mb-4">人均费用排行</h4>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={avgData} layout="vertical" margin={{ left: 20, right: 40 }}>
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
                    formatter={(value) => [`¥${Number(value).toFixed(2)}`, "人均费用"] as any}
                    contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Bar dataKey="avgCost" radius={[0, 4, 4, 0]} name="人均费用(¥)" label={{ position: "right", formatter: (v: any) => `¥${Number(v).toFixed(2)}`, fill: "#374151", fontSize: 10 }}>
                    {avgData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ===== 明细表格 ===== */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-800 mb-4">部门分账明细</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500">
                  <th className="text-left py-2 font-medium">部门</th>
                  <th className="text-right py-2 font-medium">人数</th>
                  <th className="text-right py-2 font-medium">总费用</th>
                  <th className="text-right py-2 font-medium">占比</th>
                  <th className="text-right py-2 font-medium">人均</th>
                  <th className="text-right py-2 font-medium">Token数</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-800">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        {d.department || "未分配"}
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-600">{d.userCount}</td>
                    <td className="py-2 text-right font-medium text-gray-800">¥{Number(d.cost).toFixed(2)}</td>
                    <td className="py-2 text-right text-gray-600">
                      {totalCost > 0 ? ((Number(d.cost) / totalCost) * 100).toFixed(1) : 0}%
                    </td>
                    <td className="py-2 text-right text-gray-600">¥{d.avgCost}</td>
                    <td className="py-2 text-right text-gray-600">{d.tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
