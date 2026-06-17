"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { CHART_COLORS } from "@/components/ChartColors";
import EmptyState from "@/components/EmptyState";

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

interface ModelPieChartProps {
  models: { model: string; tokens: number; cost: number; count: number }[];
}

export default function ModelPieChart({ models }: ModelPieChartProps) {
  if (models.length === 0) return <EmptyState icon="" message="暂无数据" />;

  return (
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
  );
}
