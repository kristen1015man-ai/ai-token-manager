"use client";

import { useEffect, useState } from "react";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<{ name: string; department: string; email: string; tokens: number; cost: number; count: number }[]>([]);
  const [dept, setDept] = useState("");

  useEffect(() => {
    const url = `/api/admin/employees${dept ? `?department=${encodeURIComponent(dept)}` : ""}`;
    fetch(url).then((r) => r.ok ? r.json() : null).then((d) => setEmployees(d?.employees || []));
  }, [dept]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">员工用量 Top 20</h3>
        <input
          type="text"
          placeholder="按部门筛选..."
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>

      {employees.length === 0 ? (
        <div className="py-12 text-center text-gray-400">暂无数据</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-gray-500">
              <th className="text-left py-2 font-medium">排名</th>
              <th className="text-left py-2 font-medium">姓名</th>
              <th className="text-left py-2 font-medium">部门</th>
              <th className="text-right py-2 font-medium">费用</th>
              <th className="text-right py-2 font-medium">Token</th>
              <th className="text-right py-2 font-medium">调用次数</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 text-gray-400">{i + 1}</td>
                <td className="py-2 font-medium text-gray-800">{e.name}</td>
                <td className="py-2 text-gray-600">{e.department || "未分配"}</td>
                <td className="py-2 text-right font-medium text-gray-800">¥{Number(e.cost).toFixed(2)}</td>
                <td className="py-2 text-right text-gray-600">{e.tokens.toLocaleString()}</td>
                <td className="py-2 text-right text-gray-600">{e.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
