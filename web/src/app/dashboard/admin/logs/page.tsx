"use client";

import { useEffect, useState, useCallback } from "react";

/* ===== 类型 ===== */
interface LogEntry {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

interface FetchResult {
  logs: LogEntry[];
  total: number;
}

/* ===== 常量映射 ===== */
const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create:      { label: "创建", color: "bg-green-50 text-green-700" },
  update:      { label: "更新", color: "bg-blue-50 text-blue-700" },
  delete:      { label: "删除", color: "bg-red-50 text-red-700" },
  toggle:      { label: "切换", color: "bg-purple-50 text-purple-700" },
  sync:        { label: "同步", color: "bg-cyan-50 text-cyan-700" },
  export:      { label: "导出", color: "bg-amber-50 text-amber-700" },
  migrate:     { label: "迁移", color: "bg-orange-50 text-orange-700" },
  reset_key:   { label: "重置Key", color: "bg-pink-50 text-pink-700" },
  batch_update:{ label: "批量更新", color: "bg-indigo-50 text-indigo-700" },
};

const TARGET_LABELS: Record<string, { label: string; color: string }> = {
  channel:        { label: "渠道", color: "bg-sky-50 text-sky-700" },
  user:           { label: "用户", color: "bg-violet-50 text-violet-700" },
  model:          { label: "模型", color: "bg-teal-50 text-teal-700" },
  price:          { label: "价格", color: "bg-emerald-50 text-emerald-700" },
  quota:          { label: "限额", color: "bg-yellow-50 text-yellow-700" },
  permission:     { label: "权限", color: "bg-fuchsia-50 text-fuchsia-700" },
  department:     { label: "部门", color: "bg-lime-50 text-lime-700" },
  employee:       { label: "员工", color: "bg-rose-50 text-rose-700" },
  org_structure:  { label: "组织架构", color: "bg-stone-50 text-stone-700" },
  alert_setting:  { label: "预警设置", color: "bg-orange-50 text-orange-700" },
  exchange_rate:  { label: "汇率", color: "bg-cyan-50 text-cyan-700" },
  billing:        { label: "账单", color: "bg-indigo-50 text-indigo-700" },
  system:         { label: "系统", color: "bg-gray-100 text-gray-700" },
};

const PAGE_SIZE = 20;

/* ===== 详情展示组件 ===== */
function DetailPanel({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail) return <span className="text-gray-300">—</span>;

  // 特殊格式：角色变更
  if (detail.action === "add_role" || detail.action === "remove_role" || detail.action === "set_role") {
    const roleLabel = String(detail.role || "");
    const newRoles = Array.isArray(detail.newRoles) ? detail.newRoles.join(", ") : "";
    const actionLabel = detail.action === "add_role" ? "添加角色" : detail.action === "remove_role" ? "移除角色" : "设置角色";
    return (
      <div className="space-y-1 text-xs">
        <div><span className="text-gray-500">{actionLabel}:</span> <span className="font-medium text-gray-800">{roleLabel}</span></div>
        <div><span className="text-gray-500">当前角色:</span> <span className="text-gray-700">{newRoles}</span></div>
      </div>
    );
  }

  // 特殊格式：渠道更新（列出变更字段）
  if (detail.updatedFields) {
    const fields = Array.isArray(detail.updatedFields) ? detail.updatedFields : [];
    return (
      <div className="text-xs">
        <span className="text-gray-500">变更字段:</span>{" "}
        {fields.map((f, i) => (
          <span key={i} className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded mr-1 mb-1">{String(f)}</span>
        ))}
      </div>
    );
  }

  // 特殊格式：迁移结果
  const ch = detail.channels as Record<string, number> | undefined;
  const us = detail.users as Record<string, number> | undefined;
  if (ch || us) {
    return (
      <div className="space-y-1 text-xs">
        {ch && (
          <div>
            <span className="text-gray-500">渠道密钥:</span>{" "}
            加密 {ch.encrypted} / 总计 {ch.total}
          </div>
        )}
        {us && (
          <div>
            <span className="text-gray-500">用户密钥:</span>{" "}
            加密 {us.encrypted} / 总计 {us.total}
          </div>
        )}
      </div>
    );
  }

  // 通用 JSON 展开
  return (
    <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all max-h-40 overflow-auto">
      {JSON.stringify(detail, null, 2)}
    </pre>
  );
}

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
      const res = await fetch(`/api/admin/audit-logs?${params}`);
      if (res.ok) {
        const data: FetchResult = await res.json();
        setLogs(data.logs);
        setTotal(data.total);
      }
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
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-700">筛选</span>

          {/* 操作类型 */}
          <select
            value={filterAction}
            onChange={(e) => handleFilterChange("action", e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
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
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
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
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 animate-pulse">加载中...</div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-gray-400">暂无操作记录</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
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
                <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="text-sm px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← 上一页
          </button>
          <span className="text-sm text-gray-500">
            第 {page + 1} / {totalPages} 页
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="text-sm px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            下一页 →
          </button>
        </div>
      )}
    </div>
  );
}
