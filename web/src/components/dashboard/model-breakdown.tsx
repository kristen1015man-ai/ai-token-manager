"use client";

import { useEffect, useState } from "react";
import { fetchApi, ApiError } from "../../lib/fetcher";
import { CHART_COLORS } from "@/components/ChartColors";

interface ModelUsage {
  model: string;
  tokens: number;
  cost: number;
  count: number;
}

type State =
  | { data: ModelUsage[]; error: null; loading: false }
  | { data: null; error: string; loading: false }
  | { data: null; error: null; loading: true };

export default function ModelBreakdown({ range }: { range: string }) {
  const [state, setState] = useState<State>({ data: null, error: null, loading: true });

  useEffect(() => {
    setState({ data: null, error: null, loading: true });
    fetchApi<{ models: ModelUsage[] }>(`/api/usage/by-model?range=${range}`)
      .then((d) => setState({ data: d.models, error: null, loading: false }))
      .catch((err) =>
        setState({ data: null, error: err instanceof ApiError ? err.message : "加载失败", loading: false }),
      );
  }, [range]);

  // 加载态
  if (state.loading) {
    return (
      <div className="glass-card-static p-5">
        <div className="h-5 glass-skeleton w-24 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 glass-skeleton w-32" />
              <div className="h-4 glass-skeleton w-16" />
              <div className="h-4 glass-skeleton w-16" />
              <div className="h-4 glass-skeleton w-12" />
              <div className="h-4 glass-skeleton w-12" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 错误态
  if (state.error) {
    return (
      <div className="glass-card-static p-5">
        <h3 className="font-semibold text-gray-800 mb-4">按模型汇总</h3>
        <div className="py-12 text-center text-sm text-red-500">加载失败：{state.error}</div>
      </div>
    );
  }

  const models = state.data!;

  if (models.length === 0) {
    return (
      <div className="glass-card-static p-5">
        <h3 className="font-semibold text-gray-800 mb-4">按模型汇总</h3>
        <div className="py-12 text-center text-gray-400">暂无数据</div>
      </div>
    );
  }

  const totalCost = models.reduce((s, m) => s + m.cost, 0);
  const totalTokens = models.reduce((s, m) => s + m.tokens, 0);

  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  return (
    <div className="glass-card-static p-5">
      <h3 className="font-semibold text-gray-800 mb-4">按模型汇总</h3>
      <div className="overflow-x-auto">
        <table className="glass-table min-w-[540px]">
          <thead>
            <tr>
              <th className="text-left">模型</th>
              <th className="text-right">Token 数</th>
              <th className="text-right">费用</th>
              <th className="text-right">占比</th>
              <th className="text-right">调用次数</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m, i) => (
              <tr key={m.model}>
                <td className="py-2.5 font-medium text-gray-800">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white/50"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    {m.model}
                  </span>
                </td>
                <td className="py-2.5 text-right text-gray-600">{fmt(m.tokens)}</td>
                <td className="py-2.5 text-right font-medium text-gray-800">¥{m.cost.toFixed(4)}</td>
                <td className="py-2.5 text-right text-gray-500">
                  {totalCost > 0 ? ((m.cost / totalCost) * 100).toFixed(1) : 0}%
                </td>
                <td className="py-2.5 text-right text-gray-600">{m.count}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-2.5">合计</td>
              <td className="py-2.5 text-right">{fmt(totalTokens)}</td>
              <td className="py-2.5 text-right">¥{totalCost.toFixed(4)}</td>
              <td className="py-2.5 text-right">100%</td>
              <td className="py-2.5 text-right">{models.reduce((s, m) => s + m.count, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
