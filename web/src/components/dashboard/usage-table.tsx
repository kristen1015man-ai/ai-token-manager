"use client";

import { useEffect, useState } from "react";
import { fetchApi, ApiError } from "../../lib/fetcher";
import Pagination from "@/components/Pagination";

interface Detail {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
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
        <h3 className="font-semibold mb-4" style={{ color: "var(--text-primary)" }}>最近调用</h3>
        <div className="py-12 text-center text-sm text-red-500">加载失败：{state.error}</div>
      </div>
    );
  }

  const { items, pagination } = state.data!;
  const cacheHitRate = (item: Detail) =>
    item.inputTokens > 0 ? (item.cachedTokens / item.inputTokens) * 100 : 0;

  return (
    <div className="glass-card-static p-5">
      <h3 className="font-semibold mb-4" style={{ color: "var(--text-primary)" }}>最近调用</h3>
      {items.length === 0 ? (
        <div className="py-12 text-center" style={{ color: "var(--text-muted)" }}>暂无调用记录</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="glass-table">
              <thead>
                <tr>
                  <th className="text-left">时间</th>
                  <th className="text-left">模型</th>
                  <th className="text-right">输入</th>
                  <th className="text-right">缓存命中</th>
                  <th className="text-right">输出</th>
                  <th className="text-right">费用</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatTime(item.createdAt)}</td>
                    <td>
                      <span className="glass-badge glass-badge-indigo">{item.model}</span>
                    </td>
                    <td className="text-right">{item.inputTokens.toLocaleString()}</td>
                    <td className="text-right">
                      {item.cachedTokens > 0
                        ? `${item.cachedTokens.toLocaleString()} (${cacheHitRate(item).toFixed(1)}%)`
                        : "—"}
                    </td>
                    <td className="text-right">{item.outputTokens.toLocaleString()}</td>
                    <td className="text-right font-medium" style={{ color: "var(--text-primary)" }}>¥{item.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <Pagination
              page={page - 1}
              totalPages={pagination.totalPages}
              onPageChange={(p) => setPage(p + 1)}
            />
          </div>
        </>
      )}
    </div>
  );
}
