"use client";

import { useEffect, useState } from "react";

interface LogEntry {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    fetch("/api/admin/logs").then((r) => r.ok ? r.json() : null).then((d) => setLogs(d?.logs || []));
  }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-800 mb-4">管理操作日志</h3>
      {logs.length === 0 ? (
        <div className="py-12 text-center text-gray-400">暂无操作记录</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-gray-500">
              <th className="text-left py-2 font-medium">时间</th>
              <th className="text-left py-2 font-medium">操作</th>
              <th className="text-left py-2 font-medium">对象类型</th>
              <th className="text-left py-2 font-medium">对象 ID</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 text-gray-500">
                  {new Date(l.createdAt).toLocaleString("zh-CN")}
                </td>
                <td className="py-2 font-medium text-gray-800">{l.action}</td>
                <td className="py-2">
                  <span className="px-2 py-0.5 bg-gray-50 rounded text-xs text-gray-600">{l.targetType}</span>
                </td>
                <td className="py-2 text-gray-400 font-mono text-xs">{l.targetId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
