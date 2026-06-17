"use client";

import { generateHistoryMonths, isHistoricalMonth } from "@/lib/time-range";
import GlassSelect from "@/components/GlassSelect";

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
      <GlassSelect
        value={isQuickRange ? "" : value}
        onChange={(v) => {
          if (v) onChange(v);
        }}
        options={[
          { value: "", label: "历史月份" },
          ...historyMonths.map((m) => ({ value: m.value, label: m.label })),
        ]}
        placeholder="历史月份"
        className={`text-xs [&>.glass-select-trigger]:!py-1.5 [&>.glass-select-trigger]:!px-3 [&>.glass-select-trigger]:!text-xs ${!isQuickRange && value ? "[&>.glass-select-trigger]:!border-indigo-300 [&>.glass-select-trigger]:!text-indigo-600" : ""}`}
      />
    </div>
  );
}
