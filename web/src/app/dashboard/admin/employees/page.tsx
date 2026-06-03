"use client";

import { useEffect, useState } from "react";

/* 部门颜色映射 */
const DEPT_COLORS: Record<string, { bg: string; text: string }> = {
  "经管部": { bg: "bg-amber-100", text: "text-amber-700" },
  "市场组": { bg: "bg-rose-100", text: "text-rose-700" },
  "产品中心": { bg: "bg-violet-100", text: "text-violet-700" },
  "产品部": { bg: "bg-violet-100", text: "text-violet-700" },
  "产品一组": { bg: "bg-violet-100", text: "text-violet-700" },
  "产品二组": { bg: "bg-purple-100", text: "text-purple-700" },
  "产品开发": { bg: "bg-violet-100", text: "text-violet-700" },
  "开发部": { bg: "bg-blue-100", text: "text-blue-700" },
  "开发组": { bg: "bg-blue-100", text: "text-blue-700" },
  "结构设计组": { bg: "bg-cyan-100", text: "text-cyan-700" },
  "ID设计组": { bg: "bg-teal-100", text: "text-teal-700" },
  "项目管理": { bg: "bg-indigo-100", text: "text-indigo-700" },
  "营销中心": { bg: "bg-orange-100", text: "text-orange-700" },
  "品牌营销部": { bg: "bg-orange-100", text: "text-orange-700" },
  "设计部": { bg: "bg-pink-100", text: "text-pink-700" },
  "营销中心支持组": { bg: "bg-orange-100", text: "text-orange-700" },
  "运营部": { bg: "bg-emerald-100", text: "text-emerald-700" },
  "运营一部": { bg: "bg-green-100", text: "text-green-700" },
  "运营一部一组": { bg: "bg-green-100", text: "text-green-700" },
  "运营一部二组": { bg: "bg-lime-100", text: "text-lime-700" },
  "运营一部三组": { bg: "bg-green-100", text: "text-green-700" },
  "运营一部四组": { bg: "bg-lime-100", text: "text-lime-700" },
  "运营一部五组": { bg: "bg-green-100", text: "text-green-700" },
  "CPC广告": { bg: "bg-yellow-100", text: "text-yellow-700" },
  "运营二部": { bg: "bg-emerald-100", text: "text-emerald-700" },
  "运营二部一组": { bg: "bg-emerald-100", text: "text-emerald-700" },
  "运营二部二组": { bg: "bg-teal-100", text: "text-teal-700" },
  "运营二部三组": { bg: "bg-green-100", text: "text-green-700" },
  "运营二部四组": { bg: "bg-emerald-100", text: "text-emerald-700" },
  "组织发展与赋能中心": { bg: "bg-sky-100", text: "text-sky-700" },
  "人力行政部": { bg: "bg-sky-100", text: "text-sky-700" },
  "财务部": { bg: "bg-fuchsia-100", text: "text-fuchsia-700" },
  "IT部": { bg: "bg-blue-100", text: "text-blue-700" },
  "运维组": { bg: "bg-slate-100", text: "text-slate-700" },
  "产品组": { bg: "bg-violet-100", text: "text-violet-700" },
  "计划物流中心": { bg: "bg-cyan-100", text: "text-cyan-700" },
  "仓储物流部": { bg: "bg-cyan-100", text: "text-cyan-700" },
  "物流组": { bg: "bg-cyan-100", text: "text-cyan-700" },
  "仓储组": { bg: "bg-teal-100", text: "text-teal-700" },
  "计划部": { bg: "bg-cyan-100", text: "text-cyan-700" },
  "采购与品质管理中心": { bg: "bg-stone-100", text: "text-stone-700" },
  "品质部": { bg: "bg-stone-100", text: "text-stone-700" },
  "采购寻源部": { bg: "bg-stone-100", text: "text-stone-700" },
  "采购跟单部": { bg: "bg-stone-100", text: "text-stone-700" },
};
const DEFAULT_COLOR = { bg: "bg-gray-100", text: "text-gray-600" };
function getDeptColor(dept: string) { return DEPT_COLORS[dept] || DEFAULT_COLOR; }

/* 头像组件 */
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

function DeptTag({ dept }: { dept: string }) {
  const c = getDeptColor(dept);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{dept}</span>;
}

interface Employee {
  name: string; department: string; email: string; avatar: string;
  tokens: number; cost: number; count: number;
}

const RANGE_OPTIONS = [
  { value: "day", label: "今日" },
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "year", label: "今年" },
];

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [range, setRange] = useState("month");
  const [dept, setDept] = useState("");
  const [allDepts, setAllDepts] = useState<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (range) params.set("range", range);
    if (dept) params.set("department", dept);
    fetch(`/api/admin/employees?${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const list: Employee[] = d?.employees || [];
        setEmployees(list);
        if (!dept) {
          setAllDepts([...new Set(list.map((e) => e.department).filter(Boolean))] as string[]);
        }
      });
  }, [range, dept]);

  const top3 = employees.slice(0, 3);
  const rest = employees.slice(3);

  return (
    <div className="space-y-6">
      {/* 筛选栏 */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 text-lg">员工用量排行</h3>
        <div className="flex items-center gap-3">
          {/* 时间范围切换 */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  range === opt.value ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
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
                      <DeptTag dept={top3[1].department || "未分配"} />
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
                      <DeptTag dept={top3[0].department || "未分配"} />
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
                      <DeptTag dept={top3[2].department || "未分配"} />
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
                          <div>
                            <p className="font-medium text-gray-800">{e.name}</p>
                            {e.email && <p className="text-xs text-gray-400">{e.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <DeptTag dept={e.department || "未分配"} />
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
