"use client";

import { useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import TimeRangeFilter from "@/components/TimeRangeFilter";
import { CHART_COLORS } from "@/components/ChartColors";
import { renderCustomLabel } from "@/components/PieLabel";
import { fetchApi } from "../../../../lib/fetcher";
import { type DeptData, type ChannelData, type ModelData } from "./billing-types";
import { fmt, getRangeLabel } from "./billing-helpers";
import ModelTable from "./ModelTable";

export default function BillingPage() {
  const [departments, setDepartments] = useState<DeptData[]>([]);
  const [channelData, setChannelData] = useState<ChannelData[]>([]);
  const [modelData, setModelData] = useState<ModelData[]>([]);
  const [range, setRange] = useState("30d");

  useEffect(() => {
    // 部门数据
    fetchApi<{ departments: DeptData[] }>(`/api/admin/departments?level=department&range=${range}`)
      .then((d) => setDepartments(d?.departments || []))
      .catch(() => setDepartments([]));

    // 渠道汇总
    fetchApi<{ channels: ChannelData[] }>(`/api/admin/billing/by-channel?range=${range}`)
      .then((d) => setChannelData(d?.channels || []))
      .catch(() => setChannelData([]));

    // 模型汇总
    fetchApi<{ models: ModelData[] }>(`/api/admin/billing/by-model?range=${range}`)
      .then((d) => setModelData(d?.models || []))
      .catch(() => setModelData([]));
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

  const currentLabel = getRangeLabel(range);

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
            className="glass-btn text-sm"
          >
            📥 导出 Excel
          </button>
        </div>
      </div>

      {departments.length === 0 && channelData.length === 0 ? (
        <EmptyState icon="📊" />
      ) : (
        <>
          {/* ===== 部门维度（原有） ===== */}
          {departments.length > 0 && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 饼状图 - 部门费用占比 */}
                <div className="glass-card-static p-5">
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
                        isAnimationActive={false}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [`¥${Number(value).toFixed(2)}`, "费用"] as [string, string]}
                        contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                      />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        iconType="circle"
                        iconSize={8}
                        formatter={(value: string) => {
                          const item = pieData.find(d => d.name === value);
                          const pct = item && totalCost > 0 ? ((item.value / totalCost) * 100).toFixed(1) : "0";
                          return <span style={{ fontSize: 11, color: "#666" }}>{value} ({pct}%)</span>;
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* 柱状图 - 人均费用排行 */}
                <div className="glass-card-static p-5">
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
                        formatter={(value) => [`¥${Number(value).toFixed(2)}`, "人均费用"] as [string, string]}
                        contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                      />
                      <Bar dataKey="avgCost" radius={[0, 4, 4, 0]} name="人均费用(¥)" isAnimationActive={false} label={{ position: "right", formatter: (v) => `¥${Number(v).toFixed(2)}`, fill: "#374151", fontSize: 10 }}>
                        {avgData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 部门分账明细 */}
              <div className="glass-card-static p-5">
                <h3 className="font-semibold text-gray-800 mb-4">部门分账明细</h3>
                <table className="glass-table">
                  <thead>
                    <tr>
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
            <div className="glass-card-static p-5">
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
                      isAnimationActive={false}
                    >
                      {channelPieData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [`¥${Number(value).toFixed(2)}`, "费用"] as [string, string]}
                      contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* 渠道明细表 */}
                <table className="glass-table">
                  <thead>
                    <tr>
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

          {/* ===== 模型维度 ===== */}
          <ModelTable modelData={modelData} totalCost={modelTotalCost} />
        </>
      )}
    </div>
  );
}
