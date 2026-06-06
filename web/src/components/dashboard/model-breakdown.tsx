"use client";

import { useEffect, useState } from "react";

interface ModelUsage {
  model: string;
  tokens: number;
  cost: number;
  count: number;
}

const CHART_COLORS = [
  "#4F46E5", "#E11D48", "#059669", "#D97706", "#7C3AED",
  "#0891B2", "#DC2626", "#65A30D", "#DB2777", "#0284C7",
];

export default function ModelBreakdown({ range }: { range: string }) {
  const [models, setModels] = useState<ModelUsage[]>([]);

  useEffect(() => {
    fetch(`/api/usage/by-model?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setModels(d?.models || []));
  }, [range]);

  if (models.length === 0) {
    return null;
  }

  const totalCost = models.reduce((s, m) => s + m.cost, 0);
  const totalTokens = models.reduce((s, m) => s + m.tokens, 0);

  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-800 mb-4">按模型汇总</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-gray-500">
            <th className="text-left py-2 font-medium">模型</th>
            <th className="text-right py-2 font-medium">Token 数</th>
            <th className="text-right py-2 font-medium">费用</th>
            <th className="text-right py-2 font-medium">占比</th>
            <th className="text-right py-2 font-medium">调用次数</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => (
            <tr key={m.model} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-2 font-medium text-gray-800">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                  {m.model}
                </span>
              </td>
              <td className="py-2 text-right text-gray-600">{fmt(m.tokens)}</td>
              <td className="py-2 text-right font-medium text-gray-800">¥{m.cost.toFixed(4)}</td>
              <td className="py-2 text-right text-gray-500">
                {totalCost > 0 ? ((m.cost / totalCost) * 100).toFixed(1) : 0}%
              </td>
              <td className="py-2 text-right text-gray-600">{m.count}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 font-medium text-gray-800">
            <td className="py-2">合计</td>
            <td className="py-2 text-right">{fmt(totalTokens)}</td>
            <td className="py-2 text-right">¥{totalCost.toFixed(4)}</td>
            <td className="py-2 text-right">100%</td>
            <td className="py-2 text-right">{models.reduce((s, m) => s + m.count, 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
