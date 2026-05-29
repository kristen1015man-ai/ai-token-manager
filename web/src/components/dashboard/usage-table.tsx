"use client";

import { useEffect, useState } from "react";

interface Detail {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  createdAt: string;
}

export default function UsageTable() {
  const [items, setItems] = useState<Detail[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetch(`/api/usage/details?page=${page}&size=10`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setItems(d.items);
          setTotalPages(d.pagination.totalPages);
        }
      });
  }, [page]);

  const formatTime = (t: string) => {
    const d = new Date(t);
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-800 mb-4">最近调用</h3>
      {items.length === 0 ? (
        <div className="py-12 text-center text-gray-400">暂无调用记录</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500">
                  <th className="text-left py-2 font-medium">时间</th>
                  <th className="text-left py-2 font-medium">模型</th>
                  <th className="text-right py-2 font-medium">输入</th>
                  <th className="text-right py-2 font-medium">输出</th>
                  <th className="text-right py-2 font-medium">费用</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 text-gray-600">{formatTime(item.createdAt)}</td>
                    <td className="py-2">
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs">
                        {item.model}
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-600">{item.inputTokens.toLocaleString()}</td>
                    <td className="py-2 text-right text-gray-600">{item.outputTokens.toLocaleString()}</td>
                    <td className="py-2 text-right font-medium text-gray-800">
                      ¥{item.cost.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
              >
                上一页
              </button>
              <span className="px-3 py-1 text-sm text-gray-500">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
