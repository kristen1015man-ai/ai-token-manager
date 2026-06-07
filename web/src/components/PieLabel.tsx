import { PieLabelRenderProps } from "recharts";

const RADIAN = Math.PI / 180;

/**
 * 饼图外标签通用 props — 所有字段均可选以兼容 Recharts PieLabelRenderProps
 */
export interface CustomPieLabelProps {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
  name?: string;
}

/**
 * 自定义饼图外标签 — 扇区外显示名称 + 占比
 * 支持 outer-only（无 innerRadius）和环形图两种场景
 */
export function renderCustomLabel({
  cx = 0,
  cy = 0,
  midAngle = 0,
  outerRadius = 0,
  percent = 0,
  name = "",
}: CustomPieLabelProps) {
  const radius = outerRadius + 30;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  if (percent < 0.04) return null;

  return (
    <g>
      <text
        x={x}
        y={y - 4}
        textAnchor={x > cx ? "start" : "end"}
        fill="#374151"
        fontSize="11"
        fontWeight="600"
      >
        {name}
      </text>
      <text
        x={x}
        y={y + 10}
        textAnchor={x > cx ? "start" : "end"}
        fill="#6b7280"
        fontSize="10"
      >
        {(percent * 100).toFixed(1)}%
      </text>
    </g>
  );
}

/**
 * 环形图中心标签 — 显示总费用
 */
export function PieCenterLabel({ totalCost }: { totalCost: number }) {
  return (
    <text x="50%" y="45%" textAnchor="middle" dominantBaseline="central" fill="#1f2937">
      <tspan fontSize="14" fontWeight="600">总费用</tspan>
      <tspan x="50%" dy="24" fontSize="18" fontWeight="700" fill="#4f46e5">
        ¥{totalCost.toFixed(2)}
      </tspan>
    </text>
  );
}
