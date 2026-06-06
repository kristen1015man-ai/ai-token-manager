"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import TimeRangeFilter from "@/components/TimeRangeFilter";

const CHART_COLORS = [
  "#4F46E5", "#E11D48", "#059669", "#D97706", "#7C3AED",
  "#0891B2", "#DC2626", "#65A30D", "#DB2777", "#0284C7",
  "#CA8A04", "#9333EA", "#0D9488", "#EA580C", "#2563EB",
  "#16A34A", "#C026D3", "#475569",
];

/* ===== 饼图外标签 ===== */
const RADIAN = Math.PI / 180;
function renderCustomLabel({ cx, cy, midAngle, outerRadius, percent, name }: any) {
  const radius = outerRadius + 30;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  if (percent < 0.04) return null;
  return (
    <g>
      <text x={x} y={y - 4} textAnchor={x > cx ? "start" : "end"} fill="#374151" fontSize="11" fontWeight="600">{name}</text>
      <text x={x} y={y + 10} textAnchor={x > cx ? "start" : "end"} fill="#6b7280" fontSize="10">{(percent * 100).toFixed(1)}%</text>
    </g>
  );
}

interface Overview {
  cost: number;
  tokens: number;
  count: number;
  activeUsers: number;
  rangeLabel: string;
  trend: { day: string; tokens: number; cost: number }[];
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

interface BalanceChannel {
  id: string;
  name: string;
  provider: string | null;
  currency: string;
  balance: number | null;
  balanceCurrency: string | null;
  balanceSyncedAt: string | null;
}

interface BalanceAlert {
  channelId: string;
  channelName: string;
  provider: string | null;
  balance: number | null;
  currency: string;
  threshold: number;
  severity: "warning" | "danger";
}

interface BalanceSummary {
  channels: BalanceChannel[];
  totals: Record<string, number>;
  alerts: BalanceAlert[];
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [channelData, setChannelData] = useState<ChannelData[]>([]);
  const [modelData, setModelData] = useState<ModelData[]>([]);
  const [balanceSummary, setBalanceSummary] = useState<BalanceSummary | null>(null);
  const [range, setRange] = useState("30d");

  useEffect(() => {
    fetch(`/api/admin/overview?range=${range}`).then((r) => r.ok ? r.json() : null).then(setData);
    fetch(`/api/admin/billing/by-channel?range=${range}`).then((r) => r.ok ? r.json() : null).then((d) => setChannelData(d?.channels || []));
    fetch(`/api/admin/billing/by-model?range=${range}`).then((r) => r.ok ? r.json() : null).then((d) => setModelData(d?.models || []));
    // 加载余额概览
    fetch(`/api/admin/overview?range=${range}&includeBalance=true`).then((r) => r.ok ? r.json() : null).then((d) => {
      if (d?.balanceSummary) setBalanceSummary(d.balanceSummary);
    });
  }, [range]);

  if (!data) return <div className="animate-pulse p-6">加载中...</div>;

  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

  const cards = [
    { label: `${data.rangeLabel}总费用`, value: `¥${data.cost.toFixed(2)}`, sub: `${data.count} 次调用`, color: "text-blue-600" },
    { label: `${data.rangeLabel}总Token`, value: fmt(data.tokens), sub: `${data.activeUsers} 活跃用户`, color: "text-green-600" },
    { label: `${data.rangeLabel}活跃用户`, value: `${data.activeUsers}`, sub: "有调用记录的用户", color: "text-purple-600" },
    { label: `${data.rangeLabel}总调用`, value: `${data.count}`, sub: "次请求", color: "text-orange-600" },
  ];

  const channelTotalCost = channelData.reduce((s, c) => s + c.cost, 0);
  const channelPieData = channelData.map(c => ({ name: c.channelName, value: Math.round(c.cost * 100) / 100 }));
  const modelTotalCost = modelData.reduce((s, m) => s + m.cost, 0);

  // 余额相关
  const dangerAlerts = balanceSummary?.alerts?.filter(a => a.severity === "danger") || [];
  const warningAlerts = balanceSummary?.alerts?.filter(a => a.severity === "warning") || [];
  const cnyTotal = Number(balanceSummary?.totals?.CNY ?? 0);
  const usdTotal = Number(balanceSummary?.totals?.USD ?? 0);

  return (
    <div className="space-y-6">
      {/* 筛选栏 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold text-gray-800 text-lg">全局概览</h3>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

      {/* ===== 余额告警横幅 ===== */}
      {dangerAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🔴</span>
            <span className="font-semibold text-red-700">渠道余额严重不足</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {dangerAlerts.map(a => (
              <span key={a.channelId} className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm">
                {a.channelName}：{a.currency === "USD" ? "$" : "¥"}{a.balance != null ? Number(a.balance).toFixed(2) : "未知"}
              </span>
            ))}
          </div>
          <p className="text-xs text-red-500 mt-2">请及时充值，避免服务中断</p>
        </div>
      )}
      {warningAlerts.length > 0 && dangerAlerts.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🟡</span>
            <span className="font-semibold text-amber-700">部分渠道余额偏低</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {warningAlerts.map(a => (
              <span key={a.channelId} className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm">
                {a.channelName}：{a.currency === "USD" ? "$" : "¥"}{a.balance != null ? Number(a.balance).toFixed(2) : "未知"}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">{c.label}</p>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-gray-400 mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* 费用趋势 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">{data.rangeLabel}费用趋势</h3>
        {data.trend.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-400">暂无数据</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#999" />
              <YAxis tick={{ fontSize: 11 }} stroke="#999" />
              <Tooltip contentStyle={{ borderRadius: "8px", fontSize: "12px" }} />
              <Line type="monotone" dataKey="cost" stroke="#6366f1" strokeWidth={2} dot={false} name="费用(¥)" />
              <Line type="monotone" dataKey="tokens" stroke="#10b981" strokeWidth={2} dot={false} name="Token" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ===== 按渠道汇总 ===== */}
      {channelData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">按渠道汇总</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={channelPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500">
                  <th className="text-left py-2 font-medium">渠道</th>
                  <th className="text-right py-2 font-medium">Token</th>
                  <th className="text-right py-2 font-medium">费用</th>
                  <th className="text-right py-2 font-medium">占比</th>
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
                    <td className="py-2 text-right font-medium text-gray-800">¥{c.cost.toFixed(2)}</td>
                    <td className="py-2 text-right text-gray-500">
                      {channelTotalCost > 0 ? ((c.cost / channelTotalCost) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== 按模型明细 ===== */}
      {modelData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">按模型明细</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                <th className="text-left py-2 font-medium">模型</th>
                <th className="text-right py-2 font-medium">Token</th>
                <th className="text-right py-2 font-medium">费用</th>
                <th className="text-right py-2 font-medium">占比</th>
                <th className="text-right py-2 font-medium">调用</th>
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
                  <td className="py-2 text-right font-medium text-gray-800">¥{m.cost.toFixed(2)}</td>
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
                <td className="py-2 text-right">¥{modelTotalCost.toFixed(2)}</td>
                <td className="py-2 text-right">100%</td>
                <td className="py-2 text-right">{modelData.reduce((s, m) => s + m.count, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ===== 渠道余额汇总 ===== */}
      {balanceSummary && balanceSummary.channels.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">💰 渠道余额汇总</h3>

          {/* 汇总卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {cnyTotal > 0 && (
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-xs text-green-600 mb-1">CNY 总余额</p>
                <p className="text-xl font-bold text-green-700">¥{cnyTotal.toFixed(2)}</p>
              </div>
            )}
            {usdTotal > 0 && (
              <div className="bg-sky-50 rounded-lg p-3">
                <p className="text-xs text-sky-600 mb-1">USD 总余额</p>
                <p className="text-xl font-bold text-sky-700">${usdTotal.toFixed(2)}</p>
              </div>
            )}
            {balanceSummary.alerts.length > 0 && (
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-xs text-amber-600 mb-1">低余额预警</p>
                <p className="text-xl font-bold text-amber-700">{balanceSummary.alerts.length} 个渠道</p>
              </div>
            )}
            <div className="bg-indigo-50 rounded-lg p-3">
              <p className="text-xs text-indigo-600 mb-1">监控渠道数</p>
              <p className="text-xl font-bold text-indigo-700">{balanceSummary.channels.length}</p>
            </div>
          </div>

          {/* 余额表格 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500">
                  <th className="text-left py-2 font-medium">渠道</th>
                  <th className="text-center py-2 font-medium">供应商</th>
                  <th className="text-center py-2 font-medium">余额</th>
                  <th className="text-center py-2 font-medium">状态</th>
                  <th className="text-right py-2 font-medium">同步时间</th>
                </tr>
              </thead>
              <tbody>
                {balanceSummary.channels.map((ch) => {
                  const alert = balanceSummary.alerts.find(a => a.channelId === ch.id);
                  const bal = ch.balance;
                  const cur = ch.balanceCurrency || ch.currency || "CNY";
                  const sym = cur === "USD" ? "$" : "¥";

                  let statusLabel: string;
                  let statusClass: string;
                  if (bal == null) {
                    statusLabel = "未录入";
                    statusClass = "bg-gray-100 text-gray-400";
                  } else if (alert?.severity === "danger") {
                    statusLabel = "严重不足";
                    statusClass = "bg-red-50 text-red-600";
                  } else if (alert?.severity === "warning") {
                    statusLabel = "余额偏低";
                    statusClass = "bg-amber-50 text-amber-600";
                  } else {
                    statusLabel = "正常";
                    statusClass = "bg-green-50 text-green-600";
                  }

                  return (
                    <tr key={ch.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 font-medium text-gray-800">{ch.name}</td>
                      <td className="py-2 text-center">
                        {ch.provider ? (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-600">{ch.provider}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-2 text-center">
                        {bal != null ? (
                          <span className={`font-medium ${alert?.severity === "danger" ? "text-red-600" : alert?.severity === "warning" ? "text-amber-600" : "text-green-600"}`}>
                            {sym}{Number(bal).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="py-2 text-right text-xs text-gray-400">
                        {ch.balanceSyncedAt ? new Date(ch.balanceSyncedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
