"use client";

import { useEffect, useState } from "react";

interface Alert {
  id: string;
  type: string;
  targetId: string;
  message: string;
  sentAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  personal_80: "🟡 个人 80%",
  personal_100: "🔴 个人超额",
  dept_80: "🟠 部门 80%",
  company_90: "🔴 公司 90%",
  anomaly: "⚠️ 异常使用",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    fetch("/api/admin/alerts").then((r) => r.ok ? r.json() : null).then((d) => setAlerts(d?.alerts || []));
  }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-800 mb-4">预警记录</h3>
      {alerts.length === 0 ? (
        <div className="py-12 text-center text-gray-400">暂无预警记录</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-gray-500">
              <th className="text-left py-2 font-medium">类型</th>
              <th className="text-left py-2 font-medium">时间</th>
              <th className="text-left py-2 font-medium">消息</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2">{TYPE_LABELS[a.type] || a.type}</td>
                <td className="py-2 text-gray-500">
                  {new Date(a.sentAt).toLocaleString("zh-CN")}
                </td>
                <td className="py-2 text-gray-700 max-w-md truncate">{a.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
