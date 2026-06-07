"use client";

import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { CHART_COLORS } from "@/components/ChartColors";
import EmptyState from "@/components/EmptyState";
import { fetchApi } from "../../../../lib/fetcher";

/* ===== 自定义 Tooltip ===== */
function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-2.5 text-sm">
      <p className="font-medium text-gray-900">{d.name}</p>
      <p className="text-gray-500 tabular-nums">¥{Number(d.value).toFixed(2)}</p>
    </div>
  );
}

export default function ModelsPage() {
  const [models, setModels] = useState<{ model: string; tokens: number; cost: number; count: number }[]>([]);

  useEffect(() => {
    fetchApi<{ models: { model: string; tokens: number; cost: number; count: number }[] }>("/api/admin/models")
      .then((d) => setModels(d?.models || []))
      .catch(() => setModels([]));
  }, []);

  const totalTokens = models.reduce((s, m) => s + m.tokens, 0);
  const totalCost = models.reduce((s, m) => s + m.cost, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card-static p-5">
          <h3 className="font-semibold text-gray-900 mb-4">费用分布</h3>
          {models.length === 0 ? (
            <EmptyState icon="" message="暂无数据" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={models}
                  dataKey="cost"
                  nameKey="model"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={100}
                  paddingAngle={2}
                  label={(props) => `${props.name ?? ""} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                  isAnimationActive={false}
                >
                  {models.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass-card-static p-5">
          <h3 className="font-semibold text-gray-900 mb-4">模型明细</h3>
          {models.length === 0 ? (
            <EmptyState icon="" message="暂无数据" />
          ) : (
            <table className="glass-table">
              <thead>
                <tr>
                  <th className="text-left py-2 font-medium">模型</th>
                  <th className="text-right py-2 font-medium">调用次数</th>
                  <th className="text-right py-2 font-medium">Token</th>
                  <th className="text-right py-2 font-medium">费用</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="text-sm font-medium text-gray-900">{m.model}</span>
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-gray-500 tabular-nums">{m.count}</td>
                    <td className="py-2.5 text-right text-gray-500 tabular-nums">{m.tokens.toLocaleString()}</td>
                    <td className="py-2.5 text-right font-medium text-gray-900 tabular-nums">¥{Number(m.cost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-2.5 text-gray-900 font-semibold">合计</td>
                  <td className="py-2.5 text-right text-gray-700 tabular-nums">{models.reduce((s, m) => s + m.count, 0)}</td>
                  <td className="py-2.5 text-right text-gray-700 tabular-nums">{totalTokens.toLocaleString()}</td>
                  <td className="py-2.5 text-right text-gray-900 font-semibold tabular-nums">¥{totalCost.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
