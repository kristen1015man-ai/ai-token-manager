"use client";

import { useEffect, useState, useMemo } from "react";
import { Crown, TrendingUp, TrendingDown, Minus, Zap, Award, ChevronRight } from "lucide-react";
import TimeRangeFilter from "@/components/TimeRangeFilter";
import GlassSelect from "@/components/GlassSelect";
import Avatar from "@/components/Avatar";
import EmptyState from "@/components/EmptyState";
import { fetchApi } from "../../../../lib/fetcher";
import { useTheme } from "@/context/ThemeContext";

/* ===== 动态部门颜色 ===== */
const DEPT_COLORS = [
  { pill: "bg-amber-50 text-amber-700 border-amber-200/60", progress: "bg-amber-400" },
  { pill: "bg-rose-50 text-rose-700 border-rose-200/60", progress: "bg-rose-400" },
  { pill: "bg-violet-50 text-violet-700 border-violet-200/60", progress: "bg-violet-400" },
  { pill: "bg-blue-50 text-blue-700 border-blue-200/60", progress: "bg-blue-400" },
  { pill: "bg-emerald-50 text-emerald-700 border-emerald-200/60", progress: "bg-emerald-400" },
  { pill: "bg-orange-50 text-orange-700 border-orange-200/60", progress: "bg-orange-400" },
  { pill: "bg-pink-50 text-pink-700 border-pink-200/60", progress: "bg-pink-400" },
  { pill: "bg-cyan-50 text-cyan-700 border-cyan-200/60", progress: "bg-cyan-400" },
  { pill: "bg-indigo-50 text-indigo-700 border-indigo-200/60", progress: "bg-indigo-400" },
  { pill: "bg-teal-50 text-teal-700 border-teal-200/60", progress: "bg-teal-400" },
  { pill: "bg-purple-50 text-purple-700 border-purple-200/60", progress: "bg-purple-400" },
  { pill: "bg-lime-50 text-lime-700 border-lime-200/60", progress: "bg-lime-400" },
];
const DEFAULT_COLOR = { pill: "bg-gray-50 text-gray-600 border-gray-200/60", progress: "bg-gray-400" };

function useDeptColors(deptList: string[]) {
  return useMemo(() => {
    const map: Record<string, { pill: string; progress: string }> = {};
    deptList.forEach((d, i) => {
      map[d] = DEPT_COLORS[i % DEPT_COLORS.length];
    });
    return map;
  }, [deptList]);
}

interface Employee {
  name: string;
  department: string;
  avatar: string;
  tokens: number;
  cost: number;
  count: number;
}

/* ===== Trend indicator ===== */
function TrendIcon({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp size={12} />;
  if (trend === "down") return <TrendingDown size={12} />;
  return <Minus size={12} />;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [range, setRange] = useState("30d");
  const [dept, setDept] = useState("");
  const [allDepts, setAllDepts] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"cost" | "tokens" | "count">("tokens");
  const { theme } = useTheme();
  const deptColors = useDeptColors(allDepts);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("range", range);
    params.set("level", "department");
    if (dept) params.set("department", dept);
    fetchApi<{ employees: Employee[]; departments: string[] }>(`/api/admin/employees?${params}`)
      .then((d) => {
        const list: Employee[] = d?.employees || [];
        setEmployees(list);
        if (!dept) {
          setAllDepts(d?.departments || []);
        }
      })
      .catch(() => setEmployees([]));
  }, [range, dept]);

  const getColor = (deptName: string) => deptColors[deptName] || DEFAULT_COLOR;

  // 客户端按选定维度排序
  const sorted = useMemo(() => [...employees].sort((a, b) => {
    if (sortBy === "tokens") return b.tokens - a.tokens;
    if (sortBy === "count") return b.count - a.count;
    return b.cost - a.cost;
  }), [employees, sortBy]);

  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  // 排序维度对应的取值与格式化
  const getRef = (e: Employee) =>
    sortBy === "tokens" ? e.tokens : sortBy === "count" ? e.count : e.cost;
  const maxRef = sorted.length > 0 ? Math.max(getRef(sorted[0]), 1) : 1;
  const fmtPrimary = (e: Employee) =>
    sortBy === "tokens" ? `${e.tokens.toLocaleString()} tokens`
    : sortBy === "count" ? `${e.count.toLocaleString()} 次`
    : `¥${e.cost.toFixed(2)}`;
  const fmtSecondary = (e: Employee) =>
    sortBy === "tokens" ? `¥${e.cost.toFixed(2)}`
    : sortBy === "count" ? `${e.tokens.toLocaleString()} tokens`
    : `${e.tokens.toLocaleString()} tokens`;

  /* Podium order: 2nd | 1st | 3rd */
  const podiumOrder = [
    top3[1] ? { emp: top3[1], rank: 2, medal: "silver" as const, height: "h-52" } : null,
    top3[0] ? { emp: top3[0], rank: 1, medal: "gold" as const, height: "h-64" } : null,
    top3[2] ? { emp: top3[2], rank: 3, medal: "bronze" as const, height: "h-44" } : null,
  ].filter(Boolean);

  const getTrend = (idx: number): "up" | "down" | "flat" => {
    if (idx < 2) return "up";
    if (idx < 5) return "flat";
    return "down";
  };

  return (
    <div className="space-y-8">
      {/* ===== Header Bar ===== */}
      <div className="rank-section-header" style={{ padding: 0 }}>
        <div>
          <div className="rank-section-title">
            <Award size={22} className="text-[var(--primary)]" />
            员工用量排行
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            基于选定时间范围的 AI Token 消耗排名
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <TimeRangeFilter value={range} onChange={setRange} />
          <GlassSelect
            value={dept}
            onChange={setDept}
            options={[
              { value: "", label: "全部部门" },
              ...allDepts.map((d) => ({ value: d, label: d })),
            ]}
            placeholder="全部部门"
            className="text-sm [&>.glass-select-trigger]:!py-1.5 [&>.glass-select-trigger]:!px-3"
          />
          <div className="rank-tabs">
            {(["cost", "tokens", "count"] as const).map((key) => (
              <button
                key={key}
                className={`rank-tab ${sortBy === key ? "rank-tab-active" : ""}`}
                onClick={() => setSortBy(key)}
              >
                {key === "cost" ? "费用" : key === "tokens" ? "Token" : "次数"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {employees.length === 0 ? (
        <EmptyState icon="📊" />
      ) : (
        <div className="space-y-8">
          {/* ====== LAUREATE Podium — TOP 3 ====== */}
          {top3.length > 0 && (
            <div className="glass-card-static" style={{ padding: 0, overflow: "hidden" }}>
              <div className="podium-section">
                {podiumOrder.map((item, i) => {
                  if (!item) return null;
                  const { emp, rank, medal, height } = item;
                  const isGold = medal === "gold";
                  const avatarSize = isGold ? "xl" : "lg";

                  return (
                    <div
                      key={emp.name}
                      className={`podium-col podium-anim ${isGold ? "podium-col-center" : ""}`}
                      style={{ animationDelay: `${i * 0.15}s` }}
                    >
                      {/* Avatar with ring */}
                      <div className={`podium-avatar-ring podium-${medal}`}>
                        {isGold && (
                          <div className="podium-crown-svg">
                            <Crown size={28} className="text-amber-500" fill="currentColor" />
                          </div>
                        )}
                        <div className="glow" />
                        <div className="ring">
                          <Avatar name={emp.name} size={avatarSize} avatarUrl={emp.avatar} />
                        </div>
                      </div>

                      {/* Name & Dept */}
                      <div className="text-center mb-3">
                        <p className={`font-bold ${isGold ? "text-base" : "text-sm"}`} style={{ color: "var(--text-primary)" }}>
                          {emp.name}
                        </p>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border mt-1 ${getColor(emp.department || "未分配").pill}`}
                        >
                          {emp.department || "未分配"}
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
                            <Zap size={12} className={isGold ? "text-amber-500" : medal === "silver" ? "text-slate-400" : "text-orange-400"} />
                            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                              {fmtSecondary(emp)}
                            </span>
                          </div>
                          <p className="podium-score">
                            {fmtPrimary(emp)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ====== Ranking Rows — 4th+ ====== */}
          {rest.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4 px-1">
                <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
                  完整排名
                  <span className="rank-section-count ml-2">{employees.length} 人</span>
                </p>
              </div>
              <div className="space-y-3">
                {rest.map((e, i) => {
                  const trend = getTrend(i);
                  const color = getColor(e.department || "未分配");
                  const progressPct = Math.min((getRef(e) / maxRef) * 100, 100);
                  return (
                    <div
                      key={e.name}
                      className="rank-row rank-row-anim group"
                      style={{ animationDelay: `${0.3 + i * 0.05}s` }}
                    >
                      <div className="rank-row-num">{i + 4}</div>

                      <div className="rank-row-avatar-wrap">
                        <Avatar name={e.name} size="md" avatarUrl={e.avatar} />
                      </div>

                      <div className="rank-row-info">
                        <p className="rank-row-name text-sm">{e.name}</p>
                        <span className={`inline-flex items-center px-1.5 py-0 rounded text-[9px] font-semibold border ${color.pill}`}>
                          {e.department || "未分配"}
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
                        <span className="rank-score-val">{fmtPrimary(e)}</span>
                        <span className={`rank-score-trend ${trend}`}>
                          <TrendIcon trend={trend} />
                          {trend === "up" ? "上升" : trend === "down" ? "下降" : "持平"}
                        </span>
                      </div>

                      <div
                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <ChevronRight size={16} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
