"use client";

import { useEffect, useState, useMemo } from "react";
import TimeRangeFilter from "@/components/TimeRangeFilter";
import EmptyState from "@/components/EmptyState";
import { fetchApi } from "../../../../lib/fetcher";

/* ===== 动态部门颜色 ===== */
const DEPT_COLORS = [
  { bg: "bg-amber-100", text: "text-amber-700", bar: "bg-amber-400" },
  { bg: "bg-rose-100", text: "text-rose-700", bar: "bg-rose-400" },
  { bg: "bg-violet-100", text: "text-violet-700", bar: "bg-violet-400" },
  { bg: "bg-blue-100", text: "text-blue-700", bar: "bg-blue-400" },
  { bg: "bg-emerald-100", text: "text-emerald-700", bar: "bg-emerald-400" },
  { bg: "bg-orange-100", text: "text-orange-700", bar: "bg-orange-400" },
  { bg: "bg-pink-100", text: "text-pink-700", bar: "bg-pink-400" },
  { bg: "bg-cyan-100", text: "text-cyan-700", bar: "bg-cyan-400" },
  { bg: "bg-indigo-100", text: "text-indigo-700", bar: "bg-indigo-400" },
  { bg: "bg-teal-100", text: "text-teal-700", bar: "bg-teal-400" },
  { bg: "bg-purple-100", text: "text-purple-700", bar: "bg-purple-400" },
  { bg: "bg-lime-100", text: "text-lime-700", bar: "bg-lime-400" },
  { bg: "bg-sky-100", text: "text-sky-700", bar: "bg-sky-400" },
  { bg: "bg-fuchsia-100", text: "text-fuchsia-700", bar: "bg-fuchsia-400" },
];

interface DeptData {
  department: string;
  userCount: number;
  tokens: number;
  cost: number;
  avgCost: string;
}

export default function DepartmentsPage() {
  const [data, setData] = useState<DeptData[]>([]);
  const [range, setRange] = useState("30d");

  useEffect(() => {
    fetchApi<{ departments: DeptData[] }>(`/api/admin/departments?level=department&range=${range}`)
      .then((d) => setData(d?.departments || []))
      .catch(() => setData([]));
  }, [range]);

  const totalCost = data.reduce((s, d) => s + Number(d.cost), 0);

  const top3 = data.slice(0, 3);
  const rest = data.slice(3);

  function getDeptStyle(idx: number) {
    const c = DEPT_COLORS[idx % DEPT_COLORS.length];
    return `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`;
  }

  if (data.length === 0) {
    return (
      <div className="space-y-6">
        <h3 className="font-semibold text-gray-800 text-lg">部门用量排行</h3>
        <EmptyState icon="📊" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 筛选栏 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold text-gray-800 text-lg">部门用量排行</h3>
        <TimeRangeFilter value={range} onChange={setRange} />
      </div>

      {/* ====== 领奖台 TOP 3 ====== */}
      {top3.length > 0 && (
        <div className="glass-card-static p-6">
          <div className="flex items-end justify-center gap-4">
            {/* 第2名 - 左 */}
            {top3[1] && (
              <div className="flex flex-col items-center w-1/3 max-w-[240px]">
                <div className="w-16 h-16 rounded-2xl bg-gray-200 flex items-center justify-center text-3xl">
                  🏢
                </div>
                <div className="mt-2 text-center">
                  <p className="font-bold text-gray-800 text-sm">{top3[1].department || "未分配"}</p>
                  <span className="text-xs text-gray-400">{top3[1].userCount} 人</span>
                </div>
                <div className="w-full bg-gray-200 rounded-t-xl mt-3 pt-4 pb-2 text-center" style={{ height: "80px" }}>
                  <span className="text-2xl">🥈</span>
                  <p className="text-base font-bold text-gray-800 mt-1">¥{Number(top3[1].cost).toFixed(2)}</p>
                  <p className="text-xs text-gray-500">人均 ¥{top3[1].avgCost}</p>
                </div>
              </div>
            )}

            {/* 第1名 - 中间最高 */}
            {top3[0] && (
              <div className="flex flex-col items-center w-1/3 max-w-[280px]">
                <div className="relative">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-200 to-amber-100 flex items-center justify-center text-4xl">
                    🏢
                  </div>
                  <span className="absolute -top-2 -right-2 text-2xl">👑</span>
                </div>
                <div className="mt-2 text-center">
                  <p className="font-bold text-gray-800">{top3[0].department || "未分配"}</p>
                  <span className="text-xs text-gray-400">{top3[0].userCount} 人</span>
                </div>
                <div className="w-full bg-gradient-to-t from-amber-200 to-amber-100 rounded-t-xl mt-3 pt-4 pb-2 text-center" style={{ height: "120px" }}>
                  <span className="text-3xl">🥇</span>
                  <p className="text-lg font-bold text-amber-700 mt-1">¥{Number(top3[0].cost).toFixed(2)}</p>
                  <p className="text-xs text-amber-600">人均 ¥{top3[0].avgCost}</p>
                  <p className="text-xs text-amber-500 mt-0.5">{totalCost > 0 ? ((Number(top3[0].cost) / totalCost) * 100).toFixed(1) : 0}% 占比</p>
                </div>
              </div>
            )}

            {/* 第3名 - 右 */}
            {top3[2] && (
              <div className="flex flex-col items-center w-1/3 max-w-[240px]">
                <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center text-2xl">
                  🏢
                </div>
                <div className="mt-2 text-center">
                  <p className="font-bold text-gray-800 text-sm">{top3[2].department || "未分配"}</p>
                  <span className="text-xs text-gray-400">{top3[2].userCount} 人</span>
                </div>
                <div className="w-full bg-orange-100 rounded-t-xl mt-3 pt-4 pb-2 text-center" style={{ height: "60px" }}>
                  <span className="text-2xl">🥉</span>
                  <p className="text-base font-bold text-gray-800 mt-1">¥{Number(top3[2].cost).toFixed(2)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====== 明细表格 4名以后 ====== */}
      {rest.length > 0 && (
        <div className="glass-card-static overflow-hidden">
          <table className="glass-table">
            <thead>
              <tr>
                <th className="text-center py-3 px-4 font-medium text-gray-500 w-12">排名</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500">部门</th>
                <th className="text-right py-3 px-4 font-medium text-gray-500">人数</th>
                <th className="text-right py-3 px-4 font-medium text-gray-500">总费用</th>
                <th className="text-right py-3 px-4 font-medium text-gray-500">人均</th>
                <th className="text-right py-3 px-4 font-medium text-gray-500">占比</th>
                <th className="text-right py-3 px-4 font-medium text-gray-500">Token数</th>
              </tr>
            </thead>
            <tbody>
              {rest.map((d, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="text-center py-3 px-4 text-gray-400 font-medium">{i + 4}</td>
                  <td className="py-3 px-4">
                    <span className={getDeptStyle(i)}>
                      {d.department || "未分配"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">{d.userCount}</td>
                  <td className="py-3 px-4 text-right font-semibold text-gray-800">¥{Number(d.cost).toFixed(2)}</td>
                  <td className="py-3 px-4 text-right text-gray-600">¥{d.avgCost}</td>
                  <td className="py-3 px-4 text-right text-gray-500">
                    {totalCost > 0 ? ((Number(d.cost) / totalCost) * 100).toFixed(1) : 0}%
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">{d.tokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
