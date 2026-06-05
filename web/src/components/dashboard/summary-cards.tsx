"use client";

import { useEffect, useState } from "react";

interface Summary {
  tokens: number;
  cost: number;
  count: number;
  rangeLabel: string;
  monthlyQuota: number;
  quotaUsed: number;
  quotaRemaining: number;
}

export default function SummaryCards({ range }: { range: string }) {
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    fetch(`/api/usage/summary?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, [range]);

  if (!data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-20 mb-3" />
            <div className="h-8 bg-gray-100 rounded w-24" />
          </div>
        ))}
      </div>
    );
  }

  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  const cards = [
    { label: `${data.rangeLabel}总Token`, value: fmt(data.tokens), sub: `${data.count} 次调用`, color: "text-blue-600" },
    { label: `${data.rangeLabel}总花费`, value: `¥${data.cost.toFixed(2)}`, sub: "", color: "text-green-600" },
    { label: "本月已用", value: `¥${data.quotaUsed.toFixed(2)}`, sub: `额度 ¥${data.monthlyQuota}`, color: "text-purple-600" },
    { label: "本月剩余", value: `¥${data.quotaRemaining.toFixed(2)}`, sub: `额度 ¥${data.monthlyQuota}`, color: "text-orange-600" },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">{card.label}</p>
          <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          {card.sub && <p className="text-xs text-gray-400 mt-1">{card.sub}</p>}
        </div>
      ))}
    </div>
  );
}
