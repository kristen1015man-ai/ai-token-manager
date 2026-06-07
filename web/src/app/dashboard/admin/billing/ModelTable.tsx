"use client";

/** 账单分析页 — 按模型明细表格（毛玻璃风格） */
import { CHART_COLORS } from "@/components/ChartColors";
import { type ModelData } from "./billing-types";
import { fmt } from "./billing-helpers";

interface ModelTableProps {
  modelData: ModelData[];
  totalCost: number;
}

export default function ModelTable({ modelData, totalCost }: ModelTableProps) {
  if (modelData.length === 0) return null;

  return (
    <div className="glass-card-static p-5">
      <h3 className="font-semibold text-gray-800 mb-4">按模型明细</h3>
      <div className="overflow-x-auto">
        <table className="glass-table">
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
            {modelData.map((m, i) => (
              <tr key={m.model}>
                <td className="py-2 font-medium text-gray-800">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white/50"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    {m.model}
                  </span>
                </td>
                <td className="py-2 text-right text-gray-600">{fmt(m.tokens)}</td>
                <td className="py-2 text-right font-medium text-gray-800">
                  ¥{m.cost.toFixed(4)}
                </td>
                <td className="py-2 text-right text-gray-500">
                  {totalCost > 0 ? ((m.cost / totalCost) * 100).toFixed(1) : 0}%
                </td>
                <td className="py-2 text-right text-gray-600">{m.count}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-2">合计</td>
              <td className="py-2 text-right">{fmt(modelData.reduce((s, m) => s + m.tokens, 0))}</td>
              <td className="py-2 text-right">¥{totalCost.toFixed(4)}</td>
              <td className="py-2 text-right">100%</td>
              <td className="py-2 text-right">{modelData.reduce((s, m) => s + m.count, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
