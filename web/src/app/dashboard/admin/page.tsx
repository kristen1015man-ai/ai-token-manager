"use client";

import { useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import PageLoader from "@/components/PageLoader";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import TimeRangeFilter from "@/components/TimeRangeFilter";
import { CHART_COLORS } from "@/components/ChartColors";
import { renderCustomLabel } from "@/components/PieLabel";
import { fetchApi } from "../../../lib/fetcher";
import { type Overview, type ChannelData, type ModelData, type BalanceSummary } from "./overview-types";
import BalanceSummarySection from "./BalanceSummarySection";

/* ===== 自定义 Tooltip ===== */
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm min-w-[140px]">
      <p className="text-xs text-gray-400 mb-1.5 font-medium">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-gray-500">{p.name}</span>
          </span>
          <span className="font-semibold text-gray-900 tabular-nums">
            {p.name === "费用(¥)" ? `¥${Number(p.value).toFixed(2)}` : p.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-2.5 text-sm">
      <p className="font-medium text-gray-800">{d.name}</p>
      <p className="text-gray-500">¥{Number(d.value).toFixed(2)}</p>
    </div>
  );
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [channelData, setChannelData] = useState<ChannelData[]>([]);
  const [modelData, setModelData] = useState<ModelData[]>([]);
  const [balanceSummary, setBalanceSummary] = useState<BalanceSummary | null>(null);
  const [range, setRange] = useState("30d");

  useEffect(() => {
    fetchApi<Overview & { balanceSummary?: BalanceSummary }>(`/api/admin/overview?range=${range}&includeBalance=true`)
      .then((d) => {
        setData(d);
        if (d?.balanceSummary) setBalanceSummary(d.balanceSummary);
      })
      .catch(() => setData(null));
    fetchApi<{ channels: ChannelData[] }>(`/api/admin/billing/by-channel?range=${range}`).then((d) => setChannelData(d?.channels || [])).catch(() => setChannelData([]));
    fetchApi<{ models: ModelData[] }>(`/api/admin/billing/by-model?range=${range}`).then((d) => setModelData(d?.models || [])).catch(() => setModelData([]));
  }, [range]);

  if (!data) return <PageLoader />;

  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

  const cards = [
    { label: `${data.rangeLabel}总费用`, value: `¥${data.cost.toFixed(2)}`, sub: `${data.count} 次调用`, icon: "💰", bg: "bg-indigo-50", text: "text-indigo-600" },
    { label: `${data.rangeLabel}总 Token`, value: fmt(data.tokens), sub: `${data.activeUsers} 活跃用户`, icon: "🔑", bg: "bg-emerald-50", text: "text-emerald-600" },
    { label: `${data.rangeLabel}活跃用户`, value: `${data.activeUsers}`, sub: "有调用记录的用户", icon: "👥", bg: "bg-violet-50", text: "text-violet-600" },
    { label: `${data.rangeLabel}总调用`, value: `${data.count}`, sub: "次请求", icon: "📊", bg: "bg-amber-50", text: "text-amber-600" },
  ];

  const channelTotalCost = channelData.reduce((s, c) => s + c.cost, 0);
  const channelPieData = channelData.map((c) => ({ name: c.channelName, value: Math.round(c.cost * 100) / 100 }));
  const modelTotalCost = modelData.reduce((s, m) => s + m.cost, 0);

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">全局概览</h3>
          <p className="text-sm text-gray-400 mt-0.5">Token 用量与费用实时监控</p>
        </div>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

      {/* 余额告警 + 汇总 */}
      {balanceSummary && balanceSummary.channels.length > 0 && (
        <BalanceSummarySection balanceSummary={balanceSummary} />
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="glass-card-static p-5 group">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-500 font-medium">{c.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums tracking-tight">{c.value}</p>
                <p className="text-xs text-gray-400 mt-1.5">{c.sub}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center text-base flex-shrink-0`}>
                {c.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 费用趋势 */}
      <div className="glass-card-static p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-gray-900">{data.rangeLabel}费用趋势</h3>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full bg-indigo-500" />费用</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full bg-emerald-500" />Token</span>
          </div>
        </div>
        {data.trend.length === 0 ? (
          <EmptyState icon="" message="暂无数据" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.trend} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9ca3af" }} stroke="transparent" tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} stroke="transparent" tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="cost" stroke="#6366f1" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }} name="费用(¥)" isAnimationActive={false} />
              <Line type="monotone" dataKey="tokens" stroke="#10b981" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#10b981", stroke: "#fff", strokeWidth: 2 }} name="Token" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 按渠道汇总 */}
      {channelData.length > 0 && (
        <div className="glass-card-static p-6">
          <h3 className="font-semibold text-gray-900 mb-5">按渠道汇总</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <ResponsiveContainer width="100%" height={260}>
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
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <table className="glass-table">
              <thead>
                <tr>
                  <th className="text-left">渠道</th>
                  <th className="text-right">Token</th>
                  <th className="text-right">费用</th>
                  <th className="text-right">占比</th>
                </tr>
              </thead>
              <tbody>
                {channelData.map((c, i) => (
                  <tr key={c.channelId}>
                    <td className="py-2.5 font-medium text-gray-900">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        {c.channelName}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-gray-500 tabular-nums">{fmt(c.tokens)}</td>
                    <td className="py-2.5 text-right font-medium text-gray-900 tabular-nums">¥{c.cost.toFixed(2)}</td>
                    <td className="py-2.5 text-right text-gray-400 tabular-nums">
                      {channelTotalCost > 0 ? ((c.cost / channelTotalCost) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 按模型明细 */}
      {modelData.length > 0 && (
        <div className="glass-card-static p-6">
          <h3 className="font-semibold text-gray-900 mb-5">按模型明细</h3>
          <table className="glass-table">
            <thead>
              <tr>
                <th className="text-left">模型</th>
                <th className="text-right">Token</th>
                <th className="text-right">费用</th>
                <th className="text-right">占比</th>
                <th className="text-right">调用</th>
              </tr>
            </thead>
            <tbody>
              {modelData.map((m, i) => (
                <tr key={m.model}>
                  <td className="py-2.5 font-medium text-gray-900">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      {m.model}
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-gray-500 tabular-nums">{fmt(m.tokens)}</td>
                  <td className="py-2.5 text-right font-medium text-gray-900 tabular-nums">¥{m.cost.toFixed(2)}</td>
                  <td className="py-2.5 text-right text-gray-400 tabular-nums">
                    {modelTotalCost > 0 ? ((m.cost / modelTotalCost) * 100).toFixed(1) : 0}%
                  </td>
                  <td className="py-2.5 text-right text-gray-500 tabular-nums">{m.count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="py-2.5 text-gray-900 font-semibold">合计</td>
                <td className="py-2.5 text-right text-gray-700 tabular-nums">{fmt(modelData.reduce((s, m) => s + m.tokens, 0))}</td>
                <td className="py-2.5 text-right text-gray-900 font-semibold tabular-nums">¥{modelTotalCost.toFixed(2)}</td>
                <td className="py-2.5 text-right text-gray-500 tabular-nums">100%</td>
                <td className="py-2.5 text-right text-gray-700 tabular-nums">{modelData.reduce((s, m) => s + m.count, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
