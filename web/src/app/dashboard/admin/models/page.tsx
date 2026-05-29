"use client";

import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

export default function ModelsPage() {
  const [models, setModels] = useState<{ model: string; tokens: number; cost: number; count: number }[]>([]);

  useEffect(() => {
    fetch("/api/admin/models").then((r) => r.ok ? r.json() : null).then((d) => setModels(d?.models || []));
  }, []);

  const totalTokens = models.reduce((s, m) => s + m.tokens, 0);
  const totalCost = models.reduce((s, m) => s + m.cost, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">费用分布</h3>
          {models.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400">暂无数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={models}
                  dataKey="cost"
                  nameKey="model"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  label={(props: any) => `${props.model} ${(props.percent * 100).toFixed(0)}%`}
                >
                  {models.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: "8px", fontSize: "12px" }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">模型明细</h3>
          {models.length === 0 ? (
            <div className="py-12 text-center text-gray-400">暂无数据</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500">
                  <th className="text-left py-2 font-medium">模型</th>
                  <th className="text-right py-2 font-medium">调用次数</th>
                  <th className="text-right py-2 font-medium">Token</th>
                  <th className="text-right py-2 font-medium">费用</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2">
                      <span className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: COLORS[i % COLORS.length] + "20", color: COLORS[i % COLORS.length] }}>
                        {m.model}
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-600">{m.count}</td>
                    <td className="py-2 text-right text-gray-600">{m.tokens.toLocaleString()}</td>
                    <td className="py-2 text-right font-medium text-gray-800">¥{Number(m.cost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 font-medium">
                  <td className="py-2 text-gray-800">合计</td>
                  <td className="py-2 text-right text-gray-600">{models.reduce((s, m) => s + m.count, 0)}</td>
                  <td className="py-2 text-right text-gray-600">{totalTokens.toLocaleString()}</td>
                  <td className="py-2 text-right text-gray-800">¥{totalCost.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
