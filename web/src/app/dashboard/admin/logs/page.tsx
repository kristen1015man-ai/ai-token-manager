"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchApi } from "../../../../lib/fetcher";
import EmptyState from "@/components/EmptyState";
import PageLoader from "@/components/PageLoader";
import Pagination from "@/components/Pagination";
import { type LogEntry, type FetchResult, ACTION_LABELS, TARGET_LABELS, PAGE_SIZE } from "./log-types";
import DetailPanel from "./DetailPanel";

/* ===== 主页面 ===== */
export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 筛选条件
  const [filterAction, setFilterAction] = useState("");
  const [filterTarget, setFilterTarget] = useState("");
  const [page, setPage] = useState(0);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (filterAction) params.set("action", filterAction);
    if (filterTarget) params.set("targetType", filterTarget);

    try {
      const data = await fetchApi<FetchResult>(`/api/admin/audit-logs?${params}`);
      setLogs(data.logs);
      setTotal(data.total);
    } catch {
      // fetchApi 自动抛出 ApiError，这里静默处理
    } finally {
      setLoading(false);
    }
  }, [page, filterAction, filterTarget]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 重置筛选
  const handleFilterChange = (type: "action" | "target", value: string) => {
    setPage(0);
    setExpandedId(null);
    if (type === "action") setFilterAction(value);
    else setFilterTarget(value);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const actionOptions = Object.entries(ACTION_LABELS);
  const targetOptions = Object.entries(TARGET_LABELS);

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
      <div className="glass-card-static p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-700">筛选</span>

          {/* 操作类型 */}
          <select
            value={filterAction}
            onChange={(e) => handleFilterChange("action", e.target.value)}
            className="glass-input text-sm !py-1.5 !px-3"
          >
            <option value="">全部操作</option>
            {actionOptions.map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          {/* 目标类型 */}
          <select
            value={filterTarget}
            onChange={(e) => handleFilterChange("target", e.target.value)}
            className="glass-input text-sm !py-1.5 !px-3"
          >
            <option value="">全部对象</option>
            {targetOptions.map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          {/* 统计 */}
          <span className="ml-auto text-xs text-gray-400">
            共 {total} 条记录
          </span>
        </div>
      </div>

      {/* 日志表格 */}
      <div className="glass-card-static overflow-hidden">
        {loading ? (
          <PageLoader fullPage={false} />
        ) : logs.length === 0 ? (
          <EmptyState icon="" message="暂无操作记录" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="glass-table">
                <thead>
                  <tr>
                    <th className="text-left py-3 px-4 font-medium text-gray-500 w-44">时间</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500 w-24">操作</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500 w-28">对象类型</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">对象 ID</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500 w-20">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const isExpanded = expandedId === log.id;
                    const actionInfo = ACTION_LABELS[log.action] || { label: log.action, color: "bg-gray-50 text-gray-600" };
                    const targetInfo = TARGET_LABELS[log.targetType] || { label: log.targetType, color: "bg-gray-50 text-gray-600" };

                    return (
                      <tr
                        key={log.id}
                        className={`border-b border-gray-50 transition-colors ${
                          isExpanded ? "bg-indigo-50/30" : "hover:bg-gray-50"
                        }`}
                      >
                        <td className="py-2.5 px-4 text-gray-500 text-xs">
                          {new Date(log.createdAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionInfo.color}`}>
                            {actionInfo.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${targetInfo.color}`}>
                            {targetInfo.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-gray-400 font-mono text-xs max-w-[200px] truncate" title={log.targetId}>
                          {log.targetId}
                        </td>
                        <td className="py-2.5 px-4">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : log.id)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
                          >
                            {log.detail ? (isExpanded ? "收起 ▲" : "展开 ▼") : "—"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 展开详情面板 */}
            {expandedId && (() => {
              const log = logs.find((l) => l.id === expandedId);
              if (!log) return null;
              return (
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-500">操作详情</span>
                    <span className="text-xs text-gray-300">|</span>
                    <span className="text-xs text-gray-400">
                      操作人 ID: <span className="font-mono">{log.adminId}</span>
                    </span>
                  </div>
                  <DetailPanel detail={log.detail} />
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* 分页 */}
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
