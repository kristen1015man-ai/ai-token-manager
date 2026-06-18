"use client";

import { useEffect, useState } from "react";
import { fetchApi, ApiError } from "../../lib/fetcher";

interface QuotaData {
  quotaUsed: number;
  monthlyQuota: number;
  quotaRemaining: number;
  quotaPercent?: number;
}

type State =
  | { data: QuotaData; error: null }
  | { data: null; error: string }
  | { data: null; error: null };

export default function QuotaProgress() {
  const [state, setState] = useState<State>({ data: null, error: null });

  useEffect(() => {
    setState({ data: null, error: null });
    fetchApi<QuotaData>("/api/usage/summary")
      .then((d) => setState({ data: d, error: null }))
      .catch((err) =>
        setState({ data: null, error: err instanceof ApiError ? err.message : "加载失败" })
      );
  }, []);

  if (!state.data && !state.error) {
    return (
      <div className="glass-card-static p-5 animate-pulse">
        <div className="h-4 glass-skeleton w-20 mb-2" />
        <div className="h-3 glass-skeleton rounded-full w-full" />
        <div className="h-3 glass-skeleton w-24 mt-1" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="glass-card-static p-5">
        <span className="text-sm font-medium text-gray-700">本月额度</span>
        <div className="text-sm text-red-500 mt-2">加载失败：{state.error}</div>
      </div>
    );
  }

  const { quotaUsed, monthlyQuota, quotaRemaining } = state.data!;
  const rawPercent = state.data!.quotaPercent ?? (monthlyQuota > 0 ? (quotaUsed / monthlyQuota) * 100 : 0);
  const percent = Number.isFinite(rawPercent) ? rawPercent : 0;
  const barPercent = Math.min(100, Math.max(0, percent));
  const barColor = percent >= 100 ? "bg-red-600" : percent >= 90 ? "bg-red-500" : percent >= 70 ? "bg-orange-400" : "bg-indigo-500";

  return (
    <div className="glass-card-static p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm font-medium text-gray-700">本月额度</span>
        <span className="text-sm text-gray-500 tabular-nums">
          ¥{quotaUsed.toFixed(2)} / ¥{monthlyQuota.toFixed(2)}
        </span>
      </div>
      <div className="w-full rounded-full h-3 bg-indigo-100/30">
        <div
          className={`${barColor} h-3 rounded-full transition-all duration-500`}
          style={{
            width: `${barPercent}%`,
            boxShadow: percent >= 90
              ? "0 0 8px rgba(239, 68, 68, 0.4)"
              : "0 0 8px rgba(99, 102, 241, 0.25)",
          }}
        />
      </div>
      <p className="text-xs text-gray-400 mt-1.5 tabular-nums">
        已用 {percent.toFixed(1)}%，剩余 ¥{quotaRemaining.toFixed(2)}
      </p>
    </div>
  );
}
