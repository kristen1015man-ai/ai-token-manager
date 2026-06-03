"use client";

import { useEffect, useState } from "react";

/* 部门颜色映射 - 不同部门不同配色 */
const DEPT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "经管部":      { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200" },
  "市场组":      { bg: "bg-rose-50",   text: "text-rose-700",   border: "border-rose-200" },
  "产品中心":    { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
  "产品部":      { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
  "产品一组":    { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
  "产品二组":    { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  "产品开发":    { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
  "开发部":      { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
  "开发组":      { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
  "结构设计组":  { bg: "bg-cyan-50",   text: "text-cyan-700",   border: "border-cyan-200" },
  "ID设计组":    { bg: "bg-teal-50",   text: "text-teal-700",   border: "border-teal-200" },
  "项目管理":    { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
  "营销中心":    { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  "品牌营销部":  { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  "设计部":      { bg: "bg-pink-50",   text: "text-pink-700",   border: "border-pink-200" },
  "营销中心支持组": { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  "运营部":      { bg: "bg-emerald-50",text: "text-emerald-700", border: "border-emerald-200" },
  "运营一部":    { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200" },
  "运营一部一组": { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200" },
  "运营一部二组": { bg: "bg-lime-50",   text: "text-lime-700",   border: "border-lime-200" },
  "运营一部三组": { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200" },
  "运营一部四组": { bg: "bg-lime-50",   text: "text-lime-700",   border: "border-lime-200" },
  "运营一部五组": { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200" },
  "CPC广告":     { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  "运营二部":    { bg: "bg-emerald-50",text: "text-emerald-700", border: "border-emerald-200" },
  "运营二部一组": { bg: "bg-emerald-50",text: "text-emerald-700", border: "border-emerald-200" },
  "运营二部二组": { bg: "bg-teal-50",   text: "text-teal-700",   border: "border-teal-200" },
  "运营二部三组": { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200" },
  "运营二部四组": { bg: "bg-emerald-50",text: "text-emerald-700", border: "border-emerald-200" },
  "运营二部五组": { bg: "bg-teal-50",   text: "text-teal-700",   border: "border-teal-200" },
  "组织发展与赋能中心": { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" },
  "人力行政部":  { bg: "bg-sky-50",    text: "text-sky-700",    border: "border-sky-200" },
  "财务部":      { bg: "bg-fuchsia-50",text: "text-fuchsia-700", border: "border-fuchsia-200" },
  "IT部":        { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
  "运维组":      { bg: "bg-slate-50",  text: "text-slate-700",  border: "border-slate-200" },
  "产品组":      { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
  "计划物流中心": { bg: "bg-cyan-50",   text: "text-cyan-700",   border: "border-cyan-200" },
  "仓储物流部":  { bg: "bg-cyan-50",   text: "text-cyan-700",   border: "border-cyan-200" },
  "物流组":      { bg: "bg-cyan-50",   text: "text-cyan-700",   border: "border-cyan-200" },
  "仓储组":      { bg: "bg-teal-50",   text: "text-teal-700",   border: "border-teal-200" },
  "计划部":      { bg: "bg-cyan-50",   text: "text-cyan-700",   border: "border-cyan-200" },
  "采购与品质管理中心": { bg: "bg-stone-50", text: "text-stone-700", border: "border-stone-200" },
  "品质部":      { bg: "bg-stone-50",  text: "text-stone-700",  border: "border-stone-200" },
  "采购寻源部":  { bg: "bg-stone-50",  text: "text-stone-700",  border: "border-stone-200" },
  "采购跟单部":  { bg: "bg-stone-50",  text: "text-stone-700",  border: "border-stone-200" },
};

const DEFAULT_COLOR = { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" };

function getDeptColor(dept: string) {
  return DEPT_COLORS[dept] || DEFAULT_COLOR;
}

/* 头像组件：有图片用图片，没有用姓名首字 */
function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const firstChar = name.charAt(0);
  // 根据姓名生成稳定的颜色
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-rose-500",
    "bg-amber-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
    "bg-pink-500", "bg-sky-500",
  ];
  const colorIndex = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="w-10 h-10 rounded-full object-cover ring-2 ring-white shadow-sm"
      />
    );
  }

  return (
    <div className={`w-10 h-10 rounded-full ${colors[colorIndex]} flex items-center justify-center text-white font-semibold text-sm ring-2 ring-white shadow-sm`}>
      {firstChar}
    </div>
  );
}

/* 排名徽章 */
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400 text-white text-xs font-bold shadow">🥇</span>;
  if (rank === 2) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-300 text-white text-xs font-bold shadow">🥈</span>;
  if (rank === 3) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-400 text-white text-xs font-bold shadow">🥉</span>;
  return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">{rank}</span>;
}

/* 部门标签 */
function DeptTag({ dept }: { dept: string }) {
  const color = getDeptColor(dept);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${color.bg} ${color.text} ${color.border}`}>
      {dept}
    </span>
  );
}

interface Employee {
  name: string;
  department: string;
  email: string;
  avatar: string;
  tokens: number;
  cost: number;
  count: number;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dept, setDept] = useState("");
  const [allDepts, setAllDepts] = useState<string[]>([]);

  useEffect(() => {
    const url = `/api/admin/employees${dept ? `?department=${encodeURIComponent(dept)}` : ""}`;
    fetch(url).then((r) => r.ok ? r.json() : null).then((d) => {
      const list = d?.employees || [];
      setEmployees(list);
      // 收集所有部门
      if (!dept) {
        const depts = [...new Set(list.map((e: Employee) => e.department).filter(Boolean))] as string[];
        setAllDepts(depts);
      }
    });
  }, [dept]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold text-gray-800 text-lg">员工用量排行</h3>
            <p className="text-sm text-gray-500 mt-0.5">本月 Token 消耗 Top 20</p>
          </div>
          <div className="flex items-center gap-2">
            {dept && (
              <button
                onClick={() => setDept("")}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ✕ 清除筛选
              </button>
            )}
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
            >
              <option value="">全部部门</option>
              {allDepts.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        {employees.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <div className="text-4xl mb-3">📊</div>
            <p>暂无数据</p>
          </div>
        ) : (
          <div className="space-y-2">
            {employees.map((e, i) => {
              const color = getDeptColor(e.department);
              return (
                <div
                  key={i}
                  className={`flex items-center gap-4 px-4 py-3 rounded-xl border border-gray-100 hover:border-indigo-200 hover:shadow-sm transition-all cursor-default ${i < 3 ? "bg-gradient-to-r from-amber-50/30 to-transparent" : ""}`}
                >
                  {/* 排名 */}
                  <RankBadge rank={i + 1} />

                  {/* 头像 */}
                  <Avatar name={e.name} avatarUrl={e.avatar} />

                  {/* 姓名 + 部门 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800 truncate">{e.name}</span>
                      <DeptTag dept={e.department || "未分配"} />
                    </div>
                    {e.email && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{e.email}</p>
                    )}
                  </div>

                  {/* 用量数据 */}
                  <div className="flex items-center gap-6 text-right shrink-0">
                    <div>
                      <p className="text-sm font-bold text-gray-800">¥{Number(e.cost).toFixed(2)}</p>
                      <p className="text-xs text-gray-400">费用</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">{e.tokens.toLocaleString()}</p>
                      <p className="text-xs text-gray-400">Token</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">{e.count}</p>
                      <p className="text-xs text-gray-400">调用</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
