"use client";

import { useEffect, useState } from "react";
import { fetchApi, ApiError } from "../../lib/fetcher";

interface Detail {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  createdAt: string;
}

interface PageData {
  items: Detail[];
  pagination: { totalPages: number };
}

type State =
  | { data: PageData; error: null }
  | { data: null; error: string }
  | { data: null; error: null };

export default function UsageTable() {
  const [state, setState] = useState<State>({ data: null, error: null });
  const [page, setPage] = useState(1);

  useEffect(() => {
    setState({ data: null, error: null });
    fetchApi<PageData>(`/api/usage/details?page=${page}&size=10`)
      .then((d) => setState({ data: d, error: null }))
      .catch((err) => setState({ data: null, error: err instanceof ApiError ? err.message : "加载失败" }));
  }, [page]);

  const formatTime = (t: string) => {
    const d = new Date(t);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // 加载态
  if (!state.data && !state.error) {
    return (
      <div className="glass-card-static p-5">
        <div className="h-5 glass-skeleton w-20 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 glass-skeleton w-20" />
              <div className="h-4 glass-skeleton w-24" />
              <div className="h-4 glass-skeleton w-12" />
              <div className="h-4 glass-skeleton w-12" />
              <div className="h-4 glass-skeleton w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 错误态
  if (state.error) {
    return (
      <div className="glass-card-static p-5">
        <h3 className="font-semibold text-gray-800 mb-4">最近调用</h3>
        <div className="py-12 text-center text-sm text-red-500">加载失败：{state.error}</div>
      </div>
    );
  }

  const { items, pagination } = state.data!;

  return (
    <div className="glass-card-static p-5">
      <h3 className="font-semibold text-gray-800 mb-4">最近调用</h3>
      {items.length === 0 ? (
        <div className="py-12 text-center text-gray-400">暂无调用记录</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="glass-table">
              <thead>
                <tr>
                  <th className="text-left">时间</th>
                  <th className="text-left">模型</th>
                  <th className="text-right">输入</th>
                  <th className="text-right">输出</th>
                  <th className="text-right">费用</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2.5 text-gray-600">{formatTime(item.createdAt)}</td>
                    <td className="py-2.5">
                      <span className="glass-badge" style={{ color: "#6366f1" }}>{item.model}</span>
                    </td>
                    <td className="py-2.5 text-right text-gray-600">{item.inputTokens.toLocaleString()}</td>
                    <td className="py-2.5 text-right text-gray-600">{item.outputTokens.toLocaleString()}</td>
                    <td className="py-2.5 text-right font-medium text-gray-800">¥{item.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="glass-badge px-3 py-1.5 text-sm disabled:opacity-30 cursor-pointer transition-all hover:bg-white/50"
              >
                上一页
              </button>
              <span className="px-3 py-1.5 text-sm text-gray-500">
                {page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
                disabled={page === pagination.totalPages}
                className="glass-badge px-3 py-1.5 text-sm disabled:opacity-30 cursor-pointer transition-all hover:bg-white/50"
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
