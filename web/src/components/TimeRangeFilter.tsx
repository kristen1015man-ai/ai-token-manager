"use client";

import { generateHistoryMonths, isHistoricalMonth } from "@/lib/time-range";

const QUICK_RANGES = [
  { value: "day", label: "今日" },
  { value: "7d", label: "近7天" },
  { value: "30d", label: "近30天" },
  { value: "year", label: "今年" },
];

interface Props {
  value: string;           // 当前 range: "day" | "7d" | "30d" | "year" | "YYYY-MM"
  onChange: (v: string) => void;
  className?: string;
}

export default function TimeRangeFilter({ value, onChange, className }: Props) {
  const historyMonths = generateHistoryMonths();
  const isQuickRange = QUICK_RANGES.some((r) => r.value === value);

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className || ""}`}>
      {/* 快捷按钮 */}
      <div className="flex bg-gray-100 rounded-lg p-0.5">
        {QUICK_RANGES.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              value === opt.value
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 历史月份下拉 */}
      <select
        value={isQuickRange ? "" : value}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        className={`px-3 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 ${
          !isQuickRange && value
            ? "border-indigo-400 bg-indigo-50 text-indigo-700 font-medium"
            : "border-gray-200 bg-white text-gray-600"
        }`}
      >
        <option value="">历史月份</option>
        {historyMonths.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
