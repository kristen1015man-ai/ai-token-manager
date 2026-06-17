"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import EmptyState from "@/components/EmptyState";
import { CHART_COLORS } from "@/components/ChartColors";
import { renderCustomLabel } from "@/components/PieLabel";
import { type ChannelData } from "./overview-types";

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

interface AdminOverviewChartsProps {
  trend: { day: string; tokens: number; cost: number }[];
  rangeLabel: string;
  channelData: ChannelData[];
  fmt: (n: number) => string;
}

export default function AdminOverviewCharts({ trend, rangeLabel, channelData, fmt }: AdminOverviewChartsProps) {
  const channelTotalCost = channelData.reduce((s, c) => s + c.cost, 0);
  const channelPieData = channelData.map((c) => ({ name: c.channelName, value: Math.round(c.cost * 100) / 100 }));

  return (
    <>
      {/* 费用趋势 */}
      <div className="glass-card-static p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-gray-900">{rangeLabel}费用趋势</h3>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full bg-[var(--primary)]" />费用</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full bg-emerald-500" />Token</span>
          </div>
        </div>
        {trend.length === 0 ? (
          <EmptyState icon="" message="暂无数据" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trend} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9ca3af" }} stroke="transparent" tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} stroke="transparent" tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="cost" stroke="#ef4f7a" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#ef4f7a", stroke: "#fff", strokeWidth: 2 }} name="费用(¥)" isAnimationActive={false} />
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
    </>
  );
}
