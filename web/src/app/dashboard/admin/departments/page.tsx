"use client";

import { useEffect, useState } from "react";
import {
  Crown, TrendingUp, TrendingDown, Minus, ChevronRight, Users, BarChart3, Loader2,
} from "lucide-react";
import TimeRangeFilter from "@/components/TimeRangeFilter";
import EmptyState from "@/components/EmptyState";
import Avatar from "@/components/Avatar";
import { fetchApi } from "../../../../lib/fetcher";
import { useTheme } from "@/context/ThemeContext";

/* ===== 部门头像：圆形字母缩写，风格与员工头像统一 ===== */
const MONOGRAM_COLORS = [
  "#ef4f7a", "#ff8a00", "#10b981", "#ec1680", "#f97316",
  "#eab308", "#06b6d4", "#64748b", "#22c55e", "#14b8a6",
  "#0ea5e9", "#d4af37", "#f43f5e",
];

/** 提取部门名称缩写：IT部→IT，产品部→产，品牌营销部→品 */
function getMonogram(name: string): string {
  if (/^[A-Za-z]/.test(name)) return name.replace(/部$/, "").slice(0, 2).toUpperCase();
  return name.charAt(0);
}

/** 根据名称 hash 取色 — 和 Avatar 组件同一个思路 */
function getMonogramColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return MONOGRAM_COLORS[Math.abs(h) % MONOGRAM_COLORS.length];
}

/* ===== 部门颜色 ===== */
const DEPT_COLORS = [
  { pill: "bg-amber-50 text-amber-700 border-amber-200/60", progress: "bg-amber-400", icon: "bg-amber-100 text-amber-600" },
  { pill: "bg-rose-50 text-rose-700 border-rose-200/60", progress: "bg-rose-400", icon: "bg-rose-100 text-rose-600" },
  { pill: "bg-violet-50 text-violet-700 border-violet-200/60", progress: "bg-violet-400", icon: "bg-violet-100 text-violet-600" },
  { pill: "bg-blue-50 text-blue-700 border-blue-200/60", progress: "bg-blue-400", icon: "bg-blue-100 text-blue-600" },
  { pill: "bg-emerald-50 text-emerald-700 border-emerald-200/60", progress: "bg-emerald-400", icon: "bg-emerald-100 text-emerald-600" },
  { pill: "bg-orange-50 text-orange-700 border-orange-200/60", progress: "bg-orange-400", icon: "bg-orange-100 text-orange-600" },
  { pill: "bg-pink-50 text-pink-700 border-pink-200/60", progress: "bg-pink-400", icon: "bg-pink-100 text-pink-600" },
  { pill: "bg-cyan-50 text-cyan-700 border-cyan-200/60", progress: "bg-cyan-400", icon: "bg-cyan-100 text-cyan-600" },
  { pill: "bg-indigo-50 text-indigo-700 border-indigo-200/60", progress: "bg-indigo-400", icon: "bg-indigo-100 text-indigo-600" },
  { pill: "bg-teal-50 text-teal-700 border-teal-200/60", progress: "bg-teal-400", icon: "bg-teal-100 text-teal-600" },
];

interface DeptData {
  department: string;
  userCount: number;
  tokens: number;
  cost: number;
  avgCost: string;
}

interface Employee {
  name: string;
  department: string;
  avatar: string;
  tokens: number;
  cost: number;
  count: number;
}

function TrendIcon({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp size={12} />;
  if (trend === "down") return <TrendingDown size={12} />;
  return <Minus size={12} />;
}

export default function DepartmentsPage() {
  const [data, setData] = useState<DeptData[]>([]);
  const [range, setRange] = useState("30d");
  const [sortBy, setSortBy] = useState<"cost" | "tokens" | "avgCost">("tokens");
  const { theme } = useTheme();
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [deptEmployees, setDeptEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  useEffect(() => {
    setExpandedDept(null);
    setDeptEmployees([]);
    fetchApi<{ departments: DeptData[] }>(`/api/admin/departments?level=department&range=${range}`)
      .then((d) => setData(d?.departments || []))
      .catch(() => setData([]));
  }, [range]);

  async function handleDeptClick(deptName: string) {
    if (expandedDept === deptName) {
      setExpandedDept(null);
      setDeptEmployees([]);
      return;
    }
    setExpandedDept(deptName);
    setLoadingEmployees(true);
    try {
      const d = await fetchApi<{ employees: Employee[] }>(
        `/api/admin/employees?department=${encodeURIComponent(deptName)}&range=${range}`
      );
      setDeptEmployees(d?.employees || []);
    } catch {
      setDeptEmployees([]);
    }
    setLoadingEmployees(false);
  }

  const getColor = (idx: number) => DEPT_COLORS[idx % DEPT_COLORS.length];

  // 客户端按选定维度排序
  const sorted = [...data].sort((a, b) => {
    if (sortBy === "tokens") return Number(b.tokens) - Number(a.tokens);
    if (sortBy === "avgCost") return Number(b.avgCost) - Number(a.avgCost);
    return Number(b.cost) - Number(a.cost);
  });

  const totalCost = sorted.reduce((s, d) => s + Number(d.cost), 0);
  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);
  // 排序维度对应的取值与格式化
  const getRef = (d: DeptData) =>
    sortBy === "tokens" ? Number(d.tokens) : sortBy === "avgCost" ? Number(d.avgCost) : Number(d.cost);
  const maxRef = sorted.length > 0 ? Math.max(getRef(sorted[0]), 1) : 1;
  const fmtPrimary = (d: DeptData) =>
    sortBy === "tokens" ? `${Number(d.tokens).toLocaleString()} tokens`
    : sortBy === "avgCost" ? `人均 ¥${d.avgCost}`
    : `¥${Number(d.cost).toFixed(2)}`;
  const fmtSecondary = (d: DeptData) =>
    sortBy === "tokens" ? `¥${Number(d.cost).toFixed(2)}`
    : sortBy === "avgCost" ? `${Number(d.tokens).toLocaleString()} tokens`
    : `人均 ¥${d.avgCost}`;

  /* Podium order: 2nd | 1st | 3rd */
  const podiumOrder = [
    top3[1] ? { dept: top3[1], rank: 2, medal: "silver" as const, height: "h-52", idx: 1 } : null,
    top3[0] ? { dept: top3[0], rank: 1, medal: "gold" as const, height: "h-64", idx: 0 } : null,
    top3[2] ? { dept: top3[2], rank: 3, medal: "bronze" as const, height: "h-44", idx: 2 } : null,
  ].filter(Boolean);

  const getTrend = (idx: number): "up" | "down" | "flat" => {
    if (idx < 1) return "up";
    if (idx < 3) return "flat";
    return "down";
  };

  if (data.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rank-section-title">
          <BarChart3 size={22} className="text-[var(--primary)]" />
          部门用量排行
        </div>
        <EmptyState icon="📊" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ===== Header Bar ===== */}
      <div className="rank-section-header" style={{ padding: 0 }}>
        <div>
          <div className="rank-section-title">
            <BarChart3 size={22} className="text-[var(--primary)]" />
            部门用量排行
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            各部门 AI Token 消耗总览
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <TimeRangeFilter value={range} onChange={setRange} />
          <div className="rank-tabs">
            {(["cost", "tokens", "avgCost"] as const).map((key) => (
              <button
                key={key}
                className={`rank-tab ${sortBy === key ? "rank-tab-active" : ""}`}
                onClick={() => setSortBy(key)}
              >
                {key === "cost" ? "总费用" : key === "tokens" ? "Token" : "人均"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {/* ====== LAUREATE Podium — TOP 3 ====== */}
        {top3.length > 0 && (
          <div className="glass-card-static" style={{ padding: 0, overflow: expandedDept && top3.some(t => t.department === expandedDept) ? "visible" : "hidden" }}>
            <div className="podium-section">
              {podiumOrder.map((item, i) => {
                if (!item) return null;
                const { dept, rank, medal, height, idx } = item;
                const isGold = medal === "gold";
                const color = getColor(idx);
                const isExpanded = expandedDept === dept.department;

                return (
                  <div
                    key={dept.department}
                    className={`podium-col podium-anim ${isGold ? "podium-col-center" : ""} ${isExpanded ? "podium-col-active" : ""}`}
                    data-medal={medal}
                    style={{ animationDelay: `${i * 0.15}s`, cursor: "pointer" }}
                    onClick={() => handleDeptClick(dept.department)}
                  >
                    {/* Department Icon with ring */}
                    <div className={`podium-avatar-ring podium-${medal}`}>
                      {isGold && (
                        <div className="podium-crown-svg">
                          <Crown size={28} className="text-amber-500" fill="currentColor" />
                        </div>
                      )}
                      <div className="glow" />
                      <div className="ring flex items-center justify-center">
                        <div
                          className={`${isGold ? "w-16 h-16" : "w-14 h-14"} rounded-full flex items-center justify-center shadow-md`}
                          style={{ background: getMonogramColor(dept.department) }}
                        >
                          <span className={`text-white font-bold ${isGold ? "text-xl" : "text-lg"}`}>
                            {getMonogram(dept.department)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Name & Count */}
                    <div className="text-center mb-3">
                      <p className={`font-bold ${isGold ? "text-base" : "text-sm"}`} style={{ color: "var(--text-primary)" }}>
                        {dept.department || "未分配"}
                      </p>
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-semibold mt-1"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <Users size={10} />
                        {dept.userCount} 人
                        <ChevronRight size={10} className={`transition-transform duration-300 ${isExpanded ? "rotate-90" : ""}`} />
                      </span>
                    </div>

                    {/* Marble Tower */}
                    <div className={`podium-tower podium-${medal} ${height}`}>
                      <div className="podium-tower-inner">
                        <div className="marble" />
                        <div className="stripe" />
                      </div>
                      <div className="podium-tower-content">
                        <div className="podium-rank-watermark">{rank}</div>
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                            {fmtSecondary(dept)}
                          </span>
                        </div>
                        <p className="podium-score">
                          {fmtPrimary(dept)}
                        </p>
                        {isGold && totalCost > 0 && (
                          <span
                            className="text-[10px] font-semibold mt-2"
                            style={{ color: "var(--text-muted)" }}
                          >
                            占总量 {((Number(dept.cost) / totalCost) * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* 领奖台下钻面板 */}
            {top3.map((dept) => (
              expandedDept === dept.department && (
                <div key={`drilldown-${dept.department}`} className="dept-drilldown dept-drilldown-podium">
                  {loadingEmployees ? (
                    <div className="dept-drilldown-loading">
                      <Loader2 size={14} className="animate-spin" />
                      <span>加载中...</span>
                    </div>
                  ) : deptEmployees.length === 0 ? (
                    <p className="dept-drilldown-empty">暂无员工数据</p>
                  ) : (
                    <>
                      <div className="dept-drilldown-header">
                        <span className="dept-drilldown-header-name">员工</span>
                        <span className="dept-drilldown-header-stat">费用</span>
                        <span className="dept-drilldown-header-stat">Token</span>
                        <span className="dept-drilldown-header-stat">调用</span>
                      </div>
                      {deptEmployees.map((emp) => (
                        <div key={emp.name} className="dept-emp-row">
                          <Avatar name={emp.name} size="sm" avatarUrl={emp.avatar} />
                          <span className="dept-emp-name">{emp.name}</span>
                          <span className="dept-emp-stat">¥{emp.cost.toFixed(2)}</span>
                          <span className="dept-emp-stat">{emp.tokens.toLocaleString()}</span>
                          <span className="dept-emp-stat">{emp.count}次</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )
            ))}
          </div>
        )}

        {/* ====== Ranking Rows — 4th+ ====== */}
        {rest.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4 px-1">
              <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
                完整排名
                <span className="rank-section-count ml-2">{sorted.length} 个部门</span>
              </p>
            </div>
            <div className="space-y-3">
              {rest.map((d, i) => {
                const trend = getTrend(i);
                const color = getColor(i + 3);
                const progressPct = Math.min((getRef(d) / maxRef) * 100, 100);
                const pct = totalCost > 0 ? ((Number(d.cost) / totalCost) * 100).toFixed(1) : "0";
                const isExpanded = expandedDept === d.department;

                return (
                  <div key={d.department}>
                    <div
                      className={`rank-row rank-row-anim group ${isExpanded ? "rank-row-expanded" : ""}`}
                      style={{ animationDelay: `${0.3 + i * 0.05}s` }}
                      onClick={() => handleDeptClick(d.department)}
                    >
                      <div className="rank-row-num">{i + 4}</div>

                      {(() => {
                        return (
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: getMonogramColor(d.department) }}
                          >
                            <span className="text-white font-bold text-sm">
                              {getMonogram(d.department)}
                            </span>
                          </div>
                        );
                      })()}

                      <div className="rank-row-info">
                        <p className="rank-row-name text-sm">{d.department || "未分配"}</p>
                        <span
                          className="inline-flex items-center gap-1 text-[9px] font-semibold"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <Users size={9} />
                          {d.userCount} 人 · 人均 ¥{d.avgCost}
                        </span>
                      </div>

                      <div className="rank-progress">
                        <div className="rank-progress-bar">
                          <div
                            className={`rank-progress-fill ${color.progress}`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>

                      <div className="rank-score">
                        <span className="rank-score-val">{fmtPrimary(d)}</span>
                        <span className={`rank-score-trend ${trend}`}>
                          <TrendIcon trend={trend} />
                          {pct}%
                        </span>
                      </div>

                      <div
                        className={`transition-all duration-300 ${isExpanded ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                        style={{ color: "var(--text-muted)" }}
                      >
                        <ChevronRight size={16} className={`transition-transform duration-300 ${isExpanded ? "rotate-90" : ""}`} />
                      </div>
                    </div>

                    {/* 下钻：员工明细 */}
                    {isExpanded && (
                      <div className="dept-drilldown">
                        {loadingEmployees ? (
                          <div className="dept-drilldown-loading">
                            <Loader2 size={14} className="animate-spin" />
                            <span>加载中...</span>
                          </div>
                        ) : deptEmployees.length === 0 ? (
                          <p className="dept-drilldown-empty">暂无员工数据</p>
                        ) : (
                          <>
                            <div className="dept-drilldown-header">
                              <span className="dept-drilldown-header-name">员工</span>
                              <span className="dept-drilldown-header-stat">费用</span>
                              <span className="dept-drilldown-header-stat">Token</span>
                              <span className="dept-drilldown-header-stat">调用</span>
                            </div>
                            {deptEmployees.map((emp) => (
                              <div key={emp.name} className="dept-emp-row">
                                <Avatar name={emp.name} size="sm" avatarUrl={emp.avatar} />
                                <span className="dept-emp-name">{emp.name}</span>
                                <span className="dept-emp-stat">¥{emp.cost.toFixed(2)}</span>
                                <span className="dept-emp-stat">{emp.tokens.toLocaleString()}</span>
                                <span className="dept-emp-stat">{emp.count}次</span>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
