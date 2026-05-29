"use client";

import { useEffect, useState } from "react";

export default function BillingPage() {
  const [departments, setDepartments] = useState<{ department: string; userCount: number; tokens: number; cost: number; avgCost: string }[]>([]);

  useEffect(() => {
    fetch("/api/admin/departments").then((r) => r.ok ? r.json() : null).then((d) => setDepartments(d?.departments || []));
  }, []);

  const handleExport = () => {
    window.open("/api/admin/export", "_blank");
  };

  const totalCost = departments.reduce((s, d) => s + Number(d.cost), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">本月总费用</p>
          <p className="text-3xl font-bold text-gray-900">¥{totalCost.toFixed(2)}</p>
        </div>
        <button
          onClick={handleExport}
          className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          📥 导出 CSV
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">部门分账明细</h3>
        {departments.length === 0 ? (
          <div className="py-12 text-center text-gray-400">暂无数据</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                <th className="text-left py-2 font-medium">部门</th>
                <th className="text-right py-2 font-medium">人数</th>
                <th className="text-right py-2 font-medium">总费用</th>
                <th className="text-right py-2 font-medium">占比</th>
                <th className="text-right py-2 font-medium">人均</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 font-medium text-gray-800">{d.department || "未分配"}</td>
                  <td className="py-2 text-right text-gray-600">{d.userCount}</td>
                  <td className="py-2 text-right font-medium text-gray-800">¥{Number(d.cost).toFixed(2)}</td>
                  <td className="py-2 text-right text-gray-600">
                    {totalCost > 0 ? ((Number(d.cost) / totalCost) * 100).toFixed(1) : 0}%
                  </td>
                  <td className="py-2 text-right text-gray-600">¥{d.avgCost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
