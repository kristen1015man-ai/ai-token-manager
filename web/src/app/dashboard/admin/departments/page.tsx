"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export default function DepartmentsPage() {
  const [data, setData] = useState<{ department: string; userCount: number; tokens: number; cost: number; avgCost: string }[]>([]);

  useEffect(() => {
    fetch("/api/admin/departments").then((r) => r.ok ? r.json() : null).then((d) => setData(d?.departments || []));
  }, []);

  return (
    <div className="space-y-6">
      {data.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">部门费用排行</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="department" tick={{ fontSize: 12 }} stroke="#999" />
              <YAxis tick={{ fontSize: 12 }} stroke="#999" />
              <Tooltip contentStyle={{ borderRadius: "8px", fontSize: "12px" }} />
              <Bar dataKey="cost" fill="#6366f1" radius={[4, 4, 0, 0]} name="费用(¥)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">部门明细</h3>
        {data.length === 0 ? (
          <div className="py-12 text-center text-gray-400">暂无数据</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                <th className="text-left py-2 font-medium">部门</th>
                <th className="text-right py-2 font-medium">人数</th>
                <th className="text-right py-2 font-medium">总费用</th>
                <th className="text-right py-2 font-medium">人均</th>
                <th className="text-right py-2 font-medium">Token数</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 font-medium text-gray-800">{d.department || "未分配"}</td>
                  <td className="py-2 text-right text-gray-600">{d.userCount}</td>
                  <td className="py-2 text-right font-medium text-gray-800">¥{Number(d.cost).toFixed(2)}</td>
                  <td className="py-2 text-right text-gray-600">¥{d.avgCost}</td>
                  <td className="py-2 text-right text-gray-600">{d.tokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
