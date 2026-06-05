"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import TimeRangeFilter from "@/components/TimeRangeFilter";

interface Overview {
  cost: number;
  tokens: number;
  count: number;
  activeUsers: number;
  rangeLabel: string;
  trend: { day: string; tokens: number; cost: number }[];
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [range, setRange] = useState("30d");

  useEffect(() => {
    fetch(`/api/admin/overview?range=${range}`).then((r) => r.ok ? r.json() : null).then(setData);
  }, [range]);

  if (!data) return <div className="animate-pulse p-6">加载中...</div>;

  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

  const cards = [
    { label: `${data.rangeLabel}总费用`, value: `¥${data.cost.toFixed(2)}`, sub: `${data.count} 次调用`, color: "text-blue-600" },
    { label: `${data.rangeLabel}总Token`, value: fmt(data.tokens), sub: `${data.activeUsers} 活跃用户`, color: "text-green-600" },
    { label: `${data.rangeLabel}活跃用户`, value: `${data.activeUsers}`, sub: "有调用记录的用户", color: "text-purple-600" },
    { label: `${data.rangeLabel}总调用`, value: `${data.count}`, sub: "次请求", color: "text-orange-600" },
  ];

  return (
    <div className="space-y-6">
      {/* 筛选栏 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold text-gray-800 text-lg">全局概览</h3>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">{c.label}</p>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-gray-400 mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

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
    </div>
  );
}
