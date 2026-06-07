"use client";

import { useEffect, useState } from "react";
import { fetchApi, ApiError } from "../../lib/fetcher";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ChartData {
  time: string;
  tokens: number;
  cost: number;
}

type State =
  | { data: ChartData[]; error: null; loading: false }
  | { data: null; error: string; loading: false }
  | { data: null; error: null; loading: true };

export default function UsageChart({ range }: { range: string }) {
  const [state, setState] = useState<State>({ data: null, error: null, loading: true });

  useEffect(() => {
    setState({ data: null, error: null, loading: true });
    fetchApi<{ data: ChartData[] }>(`/api/usage/chart?range=${range}`)
      .then((d) => setState({ data: d.data, error: null, loading: false }))
      .catch((err) =>
        setState({ data: null, error: err instanceof ApiError ? err.message : "加载失败", loading: false }),
      );
  }, [range]);

  // 加载态
  if (state.loading) {
    return (
      <div className="glass-card-static p-5">
        <div className="h-5 glass-skeleton w-20 mb-4" />
        <div className="h-[260px] glass-skeleton rounded-lg" />
      </div>
    );
  }

  // 错误态
  if (state.error) {
    return (
      <div className="glass-card-static p-5">
        <h3 className="font-semibold text-gray-800 mb-4">用量趋势</h3>
        <div className="h-64 flex items-center justify-center text-sm text-red-500">
          加载失败：{state.error}
        </div>
      </div>
    );
  }

  const data = state.data!;

  return (
    <div className="glass-card-static p-5">
      <h3 className="font-semibold text-gray-800 mb-4">用量趋势</h3>

      {data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400">暂无数据</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(99, 102, 241, 0.08)" />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                borderRadius: "12px",
                border: "1px solid rgba(255, 255, 255, 0.35)",
                fontSize: "12px",
                background: "rgba(255, 255, 255, 0.85)",
                backdropFilter: "blur(12px)",
                boxShadow: "0 4px 16px rgba(99, 102, 241, 0.12)",
              }}
              formatter={(value, name) => {
                const v = Number(value ?? 0);
                const n = String(name ?? "");
                if (n === "tokens") return [`${(v / 1000).toFixed(1)}K`, "Token 数"];
                return [`¥${v.toFixed(4)}`, "费用"];
              }}
            />
            <Line type="monotone" dataKey="tokens" stroke="#6366f1" strokeWidth={2.5} dot={false} name="tokens" isAnimationActive={false} />
            <Line type="monotone" dataKey="cost" stroke="#10b981" strokeWidth={2.5} dot={false} name="cost" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
