"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { CHART_COLORS } from "@/components/ChartColors";
import { renderCustomLabel } from "@/components/PieLabel";

/* ===== 部门维度：饼状图 + 柱状图 ===== */
interface DeptChartsProps {
  pieData: { name: string; value: number }[];
  totalCost: number;
  avgData: { department: string; avgCost: number }[];
}

export function DeptCharts({ pieData, totalCost, avgData }: DeptChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 饼状图 - 部门费用占比 */}
      <div className="glass-card-static p-5">
        <h4 className="font-semibold text-gray-800 mb-4">部门费用占比</h4>
        <ResponsiveContainer width="100%" height={360}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={105}
              paddingAngle={2}
              dataKey="value"
              labelLine={false}
              label={renderCustomLabel}
              isAnimationActive={false}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => [`¥${Number(value).toFixed(2)}`, "费用"] as [string, string]}
              contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
            />
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              iconType="circle"
              iconSize={8}
              formatter={(value: string) => {
                const item = pieData.find(d => d.name === value);
                const pct = item && totalCost > 0 ? ((item.value / totalCost) * 100).toFixed(1) : "0";
                return <span style={{ fontSize: 11, color: "#666" }}>{value} ({pct}%)</span>;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* 柱状图 - 人均费用排行 */}
      <div className="glass-card-static p-5">
        <h4 className="font-semibold text-gray-800 mb-4">人均费用排行</h4>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={avgData} layout="vertical" margin={{ left: 20, right: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#999" />
            <YAxis
              type="category"
              dataKey="department"
              tick={{ fontSize: 11 }}
              stroke="#999"
              width={80}
            />
            <Tooltip
              formatter={(value) => [`¥${Number(value).toFixed(2)}`, "人均费用"] as [string, string]}
              contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
            />
            <Bar dataKey="avgCost" radius={[0, 4, 4, 0]} name="人均费用(¥)" isAnimationActive={false} label={{ position: "right", formatter: (v) => `¥${Number(v).toFixed(2)}`, fill: "#374151", fontSize: 10 }}>
              {avgData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ===== 渠道维度：饼状图 ===== */
interface ChannelPieProps {
  channelPieData: { name: string; value: number }[];
}

export function ChannelPie({ channelPieData }: ChannelPieProps) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={channelPieData}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
          dataKey="value"
          labelLine={false}
          label={renderCustomLabel}
          isAnimationActive={false}
        >
          {channelPieData.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => [`¥${Number(value).toFixed(2)}`, "费用"] as [string, string]}
          contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
