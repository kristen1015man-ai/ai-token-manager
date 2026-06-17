"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import EmptyState from "@/components/EmptyState";
import TimeRangeFilter from "@/components/TimeRangeFilter";
import { CHART_COLORS } from "@/components/ChartColors";
import { fetchApi } from "../../../../lib/fetcher";
import { type DeptData, type ChannelData, type ModelData } from "./billing-types";
import { fmt, getRangeLabel } from "./billing-helpers";
import ModelTable from "./ModelTable";

const DeptCharts = dynamic(() => import("./BillingCharts").then(m => ({ default: m.DeptCharts })), { ssr: false });
const ChannelPie = dynamic(() => import("./BillingCharts").then(m => ({ default: m.ChannelPie })), { ssr: false });

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
          {/* ===== 部门维度 ===== */}
          {departments.length > 0 && (
            <>
              <DeptCharts pieData={pieData} totalCost={totalCost} avgData={avgData} />

              {/* 部门分账明细 */}
              <div className="glass-card-static p-5">
                <h3 className="font-semibold text-gray-800 mb-4">部门分账明细</h3>
                <table className="glass-table">
                  <thead>
                    <tr>
                      <th className="text-left">部门</th>
                      <th className="text-right">人数</th>
                      <th className="text-right">总费用</th>
                      <th className="text-right">占比</th>
                      <th className="text-right">人均</th>
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((d, i) => (
                      <tr key={i}>
                        <td>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            {d.department || "未分配"}
                          </span>
                        </td>
                        <td className="text-right">{d.userCount}</td>
                        <td className="text-right">¥{Number(d.cost).toFixed(2)}</td>
                        <td className="text-right">
                          {totalCost > 0 ? ((Number(d.cost) / totalCost) * 100).toFixed(1) : 0}%
                        </td>
                        <td className="text-right">¥{d.avgCost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ===== 渠道维度 ===== */}
          {channelData.length > 0 && (
            <div className="glass-card-static p-5">
              <h3 className="font-semibold text-gray-800 mb-4">按渠道汇总</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 渠道饼图 — 动态导入 */}
                <ChannelPie channelPieData={channelPieData} />
                {/* 渠道明细表 */}
                <table className="glass-table">
                  <thead>
                    <tr>
                      <th className="text-left">渠道</th>
                      <th className="text-right">Token 数</th>
                      <th className="text-right">费用</th>
                      <th className="text-right">占比</th>
                      <th className="text-right">调用次数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channelData.map((c, i) => (
                      <tr key={c.channelId}>
                        <td>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            {c.channelName}
                          </span>
                        </td>
                        <td className="text-right">{fmt(c.tokens)}</td>
                        <td className="text-right">¥{c.cost.toFixed(4)}</td>
                        <td className="text-right">
                          {channelTotalCost > 0 ? ((c.cost / channelTotalCost) * 100).toFixed(1) : 0}%
                        </td>
                        <td className="text-right">{c.count}</td>
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
