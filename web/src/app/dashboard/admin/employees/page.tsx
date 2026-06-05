"use client";

import { useEffect, useState, useMemo } from "react";
import TimeRangeFilter from "@/components/TimeRangeFilter";

/* ===== 动态部门颜色生成 ===== */
const DEPT_COLOR_POOL = [
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
  { bg: "bg-blue-100", text: "text-blue-700" },
  { bg: "bg-emerald-100", text: "text-emerald-700" },
  { bg: "bg-orange-100", text: "text-orange-700" },
  { bg: "bg-pink-100", text: "text-pink-700" },
  { bg: "bg-cyan-100", text: "text-cyan-700" },
  { bg: "bg-indigo-100", text: "text-indigo-700" },
  { bg: "bg-teal-100", text: "text-teal-700" },
  { bg: "bg-purple-100", text: "text-purple-700" },
  { bg: "bg-lime-100", text: "text-lime-700" },
  { bg: "bg-sky-100", text: "text-sky-700" },
  { bg: "bg-fuchsia-100", text: "text-fuchsia-700" },
  { bg: "bg-green-100", text: "text-green-700" },
  { bg: "bg-yellow-100", text: "text-yellow-700" },
  { bg: "bg-slate-100", text: "text-slate-700" },
  { bg: "bg-stone-100", text: "text-stone-700" },
];
const DEFAULT_COLOR = { bg: "bg-gray-100", text: "text-gray-600" };

function useDeptColors(deptList: string[]) {
  return useMemo(() => {
    const map: Record<string, { bg: string; text: string }> = {};
    deptList.forEach((d, i) => {
      map[d] = DEPT_COLOR_POOL[i % DEPT_COLOR_POOL.length];
    });
    return map;
  }, [deptList]);
}

/* ===== 头像组件 ===== */
const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-rose-500",
  "bg-amber-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
  "bg-pink-500", "bg-sky-500",
];
function getAvatarColor(name: string) {
  return AVATAR_COLORS[name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
}

function Avatar({ name, avatarUrl, size = "md" }: { name: string; avatarUrl?: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const sizes = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-14 h-14 text-lg", xl: "w-20 h-20 text-2xl" };
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className={`${sizes[size]} rounded-full object-cover ring-2 ring-white shadow`} />;
  }
  return (
    <div className={`${sizes[size]} rounded-full ${getAvatarColor(name)} flex items-center justify-center text-white font-semibold ring-2 ring-white shadow`}>
      {name.charAt(0)}
    </div>
  );
}

interface Employee {
  name: string; department: string; avatar: string;
  tokens: number; cost: number; count: number;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [range, setRange] = useState("30d");
  const [dept, setDept] = useState("");
  const [allDepts, setAllDepts] = useState<string[]>([]);
  const deptColors = useDeptColors(allDepts);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("range", range);
    params.set("level", "department");
    if (dept) params.set("department", dept);
    fetch(`/api/admin/employees?${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const list: Employee[] = d?.employees || [];
        setEmployees(list);
        if (!dept) {
          setAllDepts(d?.departments || []);
        }
      });
  }, [range, dept]);

  function getDeptStyle(deptName: string) {
    const c = deptColors[deptName] || DEFAULT_COLOR;
    return `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`;
  }

  const top3 = employees.slice(0, 3);
  const rest = employees.slice(3);

  return (
    <div className="space-y-6">
      {/* 筛选栏 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold text-gray-800 text-lg">员工用量排行</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <TimeRangeFilter value={range} onChange={setRange} />
          {/* 部门筛选 */}
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
          >
            <option value="">全部部门</option>
            {allDepts.map((d) => (<option key={d} value={d}>{d}</option>))}
          </select>
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <p>暂无数据</p>
        </div>
      ) : (
        <>
          {/* ====== 领奖台 TOP 3 ====== */}
          {top3.length > 0 && (
            <div className="bg-gradient-to-br from-indigo-50 via-white to-amber-50 rounded-2xl border border-gray-200 p-6">
              <div className="flex items-end justify-center gap-4">
                {/* 第2名 - 左 */}
                {top3[1] && (
                  <div className="flex flex-col items-center w-1/3 max-w-[200px]">
                    <Avatar name={top3[1].name} avatarUrl={top3[1].avatar} size="lg" />
                    <div className="mt-2 text-center">
                      <p className="font-bold text-gray-800 text-sm">{top3[1].name}</p>
                      <span className={getDeptStyle(top3[1].department || "未分配")}>
                        {top3[1].department || "未分配"}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-t-xl mt-3 pt-4 pb-2 text-center" style={{ height: "80px" }}>
                      <span className="text-2xl">🥈</span>
                      <p className="text-base font-bold text-gray-800 mt-1">¥{top3[1].cost.toFixed(2)}</p>
                    </div>
                  </div>
                )}

                {/* 第1名 - 中间最高 */}
                {top3[0] && (
                  <div className="flex flex-col items-center w-1/3 max-w-[220px]">
                    <div className="relative">
                      <Avatar name={top3[0].name} avatarUrl={top3[0].avatar} size="xl" />
                      <span className="absolute -top-2 -right-2 text-2xl">👑</span>
                    </div>
                    <div className="mt-2 text-center">
                      <p className="font-bold text-gray-800">{top3[0].name}</p>
                      <span className={getDeptStyle(top3[0].department || "未分配")}>
                        {top3[0].department || "未分配"}
                      </span>
                    </div>
                    <div className="w-full bg-gradient-to-t from-amber-200 to-amber-100 rounded-t-xl mt-3 pt-4 pb-2 text-center" style={{ height: "120px" }}>
                      <span className="text-3xl">🥇</span>
                      <p className="text-lg font-bold text-amber-700 mt-1">¥{top3[0].cost.toFixed(2)}</p>
                      <p className="text-xs text-amber-600">{top3[0].tokens.toLocaleString()} tokens</p>
                    </div>
                  </div>
                )}

                {/* 第3名 - 右 */}
                {top3[2] && (
                  <div className="flex flex-col items-center w-1/3 max-w-[200px]">
                    <Avatar name={top3[2].name} avatarUrl={top3[2].avatar} size="lg" />
                    <div className="mt-2 text-center">
                      <p className="font-bold text-gray-800 text-sm">{top3[2].name}</p>
                      <span className={getDeptStyle(top3[2].department || "未分配")}>
                        {top3[2].department || "未分配"}
                      </span>
                    </div>
                    <div className="w-full bg-orange-100 rounded-t-xl mt-3 pt-4 pb-2 text-center" style={{ height: "60px" }}>
                      <span className="text-2xl">🥉</span>
                      <p className="text-base font-bold text-gray-800 mt-1">¥{top3[2].cost.toFixed(2)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ====== 明细列表 4名以后 ====== */}
          {rest.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-center py-3 px-4 font-medium text-gray-500 w-12">排名</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">员工</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">部门</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">费用</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Token</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">调用次数</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((e, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="text-center py-3 px-4 text-gray-400 font-medium">{i + 4}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={e.name} avatarUrl={e.avatar} size="sm" />
                          <p className="font-medium text-gray-800">{e.name}</p>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={getDeptStyle(e.department || "未分配")}>
                          {e.department || "未分配"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-gray-800">¥{e.cost.toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{e.tokens.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{e.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
