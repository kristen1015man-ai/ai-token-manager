"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Granularity = "hourly" | "daily" | "weekly" | "monthly";

const TABS: { label: string; value: Granularity }[] = [
  { label: "今日(小时)", value: "hourly" },
  { label: "本月(天)", value: "daily" },
  { label: "近3月(周)", value: "weekly" },
  { label: "全年(月)", value: "monthly" },
];

export default function UsageChart() {
  const [granularity, setGranularity] = useState<Granularity>("hourly");
  const [data, setData] = useState<{ time: string; tokens: number; cost: number }[]>([]);

  useEffect(() => {
    fetch(`/api/usage/chart?granularity=${granularity}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d?.data || []));
  }, [granularity]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">用量趋势</h3>
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setGranularity(tab.value)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                granularity === tab.value
                  ? "bg-indigo-100 text-indigo-700 font-medium"
                  : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400">
          暂无数据
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="#999" />
            <YAxis tick={{ fontSize: 12 }} stroke="#999" />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                fontSize: "12px",
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => {
                const v = Number(value);
                const n = String(name);
                return [
                  n === "tokens" ? `${(v / 1000).toFixed(1)}K` : `¥${v.toFixed(4)}`,
                  n === "tokens" ? "Token 数" : "费用",
                ];
              }}
            />
            <Line
              type="monotone"
              dataKey="tokens"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              name="tokens"
            />
            <Line
              type="monotone"
              dataKey="cost"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              name="cost"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
