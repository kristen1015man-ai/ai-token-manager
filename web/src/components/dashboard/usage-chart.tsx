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

export default function UsageChart({ range }: { range: string }) {
  const [data, setData] = useState<{ time: string; tokens: number; cost: number }[]>([]);

  useEffect(() => {
    fetch(`/api/usage/chart?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d?.data || []));
  }, [range]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-800 mb-4">用量趋势</h3>

      {data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400">
          暂无数据
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#999" />
            <YAxis tick={{ fontSize: 11 }} stroke="#999" />
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
                if (n === "tokens") return [`${(v / 1000).toFixed(1)}K`, "Token 数"];
                return [`¥${v.toFixed(4)}`, "费用"];
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
