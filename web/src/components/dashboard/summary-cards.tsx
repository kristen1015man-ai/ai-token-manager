"use client";

import { useEffect, useState } from "react";
import { fetchApi, ApiError } from "../../lib/fetcher";

interface Summary {
  tokens: number;
  cost: number;
  count: number;
  rangeLabel: string;
  monthlyQuota: number;
  quotaUsed: number;
  quotaRemaining: number;
}

type State = { data: Summary; error: null } | { data: null; error: string } | { data: null; error: null };

export default function SummaryCards({ range }: { range: string }) {
  const [state, setState] = useState<State>({ data: null, error: null });

  useEffect(() => {
    setState({ data: null, error: null });
    fetchApi<Summary>(`/api/usage/summary?range=${range}`)
      .then((d) => setState({ data: d, error: null }))
      .catch((err) => setState({ data: null, error: err instanceof ApiError ? err.message : "加载失败" }));
  }, [range]);

  // 加载态
  if (!state.data && !state.error) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="glass-card-static p-5 animate-pulse">
            <div className="h-4 glass-skeleton w-20 mb-3" />
            <div className="h-8 glass-skeleton w-24" />
          </div>
        ))}
      </div>
    );
  }

  // 错误态
  if (state.error) {
    return (
      <div className="glass-card-static p-4 text-sm text-red-600 border-red-200/50 bg-red-50/70">
        统计数据加载失败：{state.error}
      </div>
    );
  }

  const data = state.data!;
  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  const cards = [
    { label: `${data.rangeLabel}总Token`, value: fmt(data.tokens), sub: `${data.count} 次调用`, color: "text-blue-600", icon: "⚡" },
    { label: `${data.rangeLabel}总花费`, value: `¥${data.cost.toFixed(2)}`, sub: "", color: "text-emerald-600", icon: "💰" },
    { label: "本月已用", value: `¥${data.quotaUsed.toFixed(2)}`, sub: `额度 ¥${data.monthlyQuota}`, color: "text-purple-600", icon: "📊" },
    { label: "本月剩余", value: `¥${data.quotaRemaining.toFixed(2)}`, sub: `额度 ¥${data.monthlyQuota}`, color: "text-orange-600", icon: "📈" },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {cards.map((card, i) => (
        <div
          key={card.label}
          className="glass-card p-5 animate-glass-fade-in"
          style={{ animationDelay: `${i * 80}ms`, animationFillMode: "both" }}
        >
          <p className="text-sm text-gray-500 mb-1 font-medium">{card.label}</p>
          <p className={`text-2xl font-bold ${card.color} tracking-tight`}>{card.value}</p>
          {card.sub && <p className="text-xs text-gray-400 mt-1.5">{card.sub}</p>}
        </div>
      ))}
    </div>
  );
}
