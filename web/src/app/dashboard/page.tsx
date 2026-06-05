"use client";

import { useState } from "react";
import TimeRangeFilter from "../../components/TimeRangeFilter";
import SummaryCards from "../../components/dashboard/summary-cards";
import QuotaProgress from "../../components/dashboard/quota-progress";
import UsageChart from "../../components/dashboard/usage-chart";

export default function DashboardPage() {
  const [range, setRange] = useState("day");

  return (
    <div className="space-y-6">
      {/* 顶部：标题 + 时间筛选 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold text-gray-800 text-lg">我的用量</h3>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

      {/* 统计卡片：跟随 range 刷新 */}
      <SummaryCards range={range} />

      {/* 用量趋势图：跟随 range 刷新 */}
      <UsageChart range={range} />

      {/* 本月额度：始终按月 */}
      <QuotaProgress />
    </div>
  );
}
