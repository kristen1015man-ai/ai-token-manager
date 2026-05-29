"use client";

import { useEffect, useState } from "react";

export default function QuotaProgress() {
  const [quota, setQuota] = useState({ used: 0, limit: 200, remaining: 200 });

  useEffect(() => {
    fetch("/api/usage/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setQuota({ used: d.quotaUsed, limit: d.monthlyQuota, remaining: d.quotaRemaining });
      });
  }, []);

  const percent = quota.limit ? Math.min(100, (quota.used / quota.limit) * 100) : 0;
  const barColor =
    percent >= 90 ? "bg-red-500" : percent >= 70 ? "bg-orange-400" : "bg-indigo-500";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">本月额度</span>
        <span className="text-sm text-gray-500">
          ¥{quota.used.toFixed(2)} / ¥{quota.limit}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-3">
        <div
          className={`${barColor} h-3 rounded-full transition-all duration-500`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-gray-400 mt-1">
        {percent >= 90 ? "⚠️ 额度即将用完" : `剩余 ¥${quota.remaining.toFixed(2)}`}
      </p>
    </div>
  );
}
