"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import TimeRangeFilter from "@/components/TimeRangeFilter";

/* ===== 颜色池 — 高区分度 ===== */
const CHART_COLORS = [
  "#4F46E5", "#E11D48", "#059669", "#D97706", "#7C3AED",
  "#0891B2", "#DC2626", "#65A30D", "#DB2777", "#0284C7",
  "#CA8A04", "#9333EA", "#0D9488", "#EA580C", "#2563EB",
  "#16A34A", "#C026D3", "#475569",
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

/* ===== 自定义饼图标签（扇区外显示名称+占比） ===== */
const RADIAN = Math.PI / 180;
function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: any) {
  const radius = outerRadius + 35;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  if (percent < 0.04) return null;

  return (
    <g>
      <text x={x} y={y - 5} textAnchor={x > cx ? "start" : "end"} fill="#374151" fontSize="11" fontWeight="600">
        {name}
      </text>
      <text x={x} y={y + 9} textAnchor={x > cx ? "start" : "end"} fill="#6b7280" fontSize="10">
        {(percent * 100).toFixed(1)}%
      </text>
    </g>
  );
}

/* ===== 数据类型 ===== */
interface DeptData {
  department: string;
  userCount: number;
  tokens: number;
  cost: number;
  avgCost: string;
}

interface ChannelData {
  channelId: string;
  channelName: string;
  channelCurrency: string;
  tokens: number;
  cost: number;
  count: number;
}

interface ModelData {
  model: string;
  tokens: number;
  cost: number;
  count: number;
}

export default function BillingPage() {
  const [departments, setDepartments] = useState<DeptData[]>([]);
  const [channelData, setChannelData] = useState<ChannelData[]>([]);
  const [modelData, setModelData] = useState<ModelData[]>([]);
  const [range, setRange] = useState("30d");

  useEffect(() => {
    // 部门数据
    fetch(`/api/admin/departments?level=department&range=${range}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setDepartments(d?.departments || []));

    // 渠道汇总
    fetch(`/api/admin/billing/by-channel?range=${range}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setChannelData(d?.channels || []));

    // 模型汇总
    fetch(`/api/admin/billing/by-model?range=${range}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setModelData(d?.models || []));
  }, [range]);

  const handleExport = () => {
    window.open(`/api/admin/export?range=${range}`, "_blank");
  };

  const totalCost = departments.reduce((s, d) => s + Number(d.cost), 0);

  const pieData = departments.map(d => ({
    name: d.department || "未分配",
    value: Math.round(Number(d.cost) * 100) / 100,
  }));

  const avgData = departments
    .map(d => ({ department: d.department || "未分配", avgCost: Number(d.avgCost) }))
    .sort((a, b) => b.avgCost - a.avgCost);

  // 渠道汇总
  const channelTotalCost = channelData.reduce((s, c) => s + c.cost, 0);
  const channelPieData = channelData.map(c => ({
    name: c.channelName,
    value: Math.round(c.cost * 100) / 100,
  }));

  // 模型汇总
  const modelTotalCost = modelData.reduce((s, m) => s + m.cost, 0);

  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  const rangeLabels: Record<string, string> = {
    day: "今日", "7d": "近7天", "30d": "近30天", year: "今年",
  };

  const currentLabel = range.match(/^\d{4}-\d{2}$/)
    ? `${range.split("-")[0]}年${parseInt(range.split("-")[1])}月`
    : rangeLabels[range] || "近30天";

  return (
    <div className="space-y-6">
      {/* 头部：总费用 + 筛选 + 导出 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-gray-500">{currentLabel}总费用</p>
          <p className="text-3xl font-bold text-gray-900">¥{totalCost.toFixed(2)}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <TimeRangeFilter value={range} onChange={setRange} />
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            📥 导出 Excel
          </button>
        </div>
      </div>

      {departments.length === 0 && channelData.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <p>暂无数据</p>
        </div>
      ) : (
        <>
          {/* ===== 部门维度（原有） ===== */}
          {departments.length > 0 && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 饼状图 - 部门费用占比 */}
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

              {/* 部门分账明细 */}
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ===== 渠道维度（新增） ===== */}
          {channelData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-800 mb-4">按渠道汇总</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 渠道饼图 */}
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={channelPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                      labelLine={false}
                      label={renderCustomLabel}
                    >
                      {channelPieData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [`¥${Number(value).toFixed(2)}`, "费用"] as any}
                      contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* 渠道明细表 */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-500">
                      <th className="text-left py-2 font-medium">渠道</th>
                      <th className="text-right py-2 font-medium">Token 数</th>
                      <th className="text-right py-2 font-medium">费用</th>
                      <th className="text-right py-2 font-medium">占比</th>
                      <th className="text-right py-2 font-medium">调用次数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channelData.map((c, i) => (
                      <tr key={c.channelId} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 font-medium text-gray-800">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            {c.channelName}
                          </span>
                        </td>
                        <td className="py-2 text-right text-gray-600">{fmt(c.tokens)}</td>
                        <td className="py-2 text-right font-medium text-gray-800">¥{c.cost.toFixed(4)}</td>
                        <td className="py-2 text-right text-gray-500">
                          {channelTotalCost > 0 ? ((c.cost / channelTotalCost) * 100).toFixed(1) : 0}%
                        </td>
                        <td className="py-2 text-right text-gray-600">{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ===== 模型维度（新增） ===== */}
          {modelData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-800 mb-4">按模型明细</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500">
                    <th className="text-left py-2 font-medium">模型</th>
                    <th className="text-right py-2 font-medium">Token 数</th>
                    <th className="text-right py-2 font-medium">费用</th>
                    <th className="text-right py-2 font-medium">占比</th>
                    <th className="text-right py-2 font-medium">调用次数</th>
                  </tr>
                </thead>
                <tbody>
                  {modelData.map((m, i) => (
                    <tr key={m.model} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 font-medium text-gray-800">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                          {m.model}
                        </span>
                      </td>
                      <td className="py-2 text-right text-gray-600">{fmt(m.tokens)}</td>
                      <td className="py-2 text-right font-medium text-gray-800">¥{m.cost.toFixed(4)}</td>
                      <td className="py-2 text-right text-gray-500">
                        {modelTotalCost > 0 ? ((m.cost / modelTotalCost) * 100).toFixed(1) : 0}%
                      </td>
                      <td className="py-2 text-right text-gray-600">{m.count}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 font-medium text-gray-800">
                    <td className="py-2">合计</td>
                    <td className="py-2 text-right">{fmt(modelData.reduce((s, m) => s + m.tokens, 0))}</td>
                    <td className="py-2 text-right">¥{modelTotalCost.toFixed(4)}</td>
                    <td className="py-2 text-right">100%</td>
                    <td className="py-2 text-right">{modelData.reduce((s, m) => s + m.count, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
