"use client";

import { generateHistoryMonths, isHistoricalMonth } from "@/lib/time-range";

const QUICK_RANGES = [
  { value: "day", label: "今日" },
  { value: "7d", label: "近7天" },
  { value: "30d", label: "近30天" },
  { value: "year", label: "今年" },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

export default function TimeRangeFilter({ value, onChange, className }: Props) {
  const historyMonths = generateHistoryMonths();
  const isQuickRange = QUICK_RANGES.some((r) => r.value === value);

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className || ""}`}>
      {/* 快捷按钮 */}
      <div
        className="flex rounded-xl p-1 bg-indigo-50/30 border border-indigo-100"
      >
        {QUICK_RANGES.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
              value === opt.value
                ? "text-indigo-700 shadow-sm bg-white"
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
        className={`glass-input text-xs py-1.5 px-3 ${!isQuickRange && value ? "border-indigo-300 text-indigo-600" : ""}`}
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
