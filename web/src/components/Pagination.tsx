/** 分页导航组件 — 替代各页面重复的分页按钮模板 */

interface PaginationProps {
  /** 当前页（从 0 开始） */
  page: number;
  /** 总页数 */
  totalPages: number;
  /** 页码变更回调 */
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
      <button
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className="text-sm px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        ← 上一页
      </button>
      <span className="text-sm text-gray-500">
        第 {page + 1} / {totalPages} 页
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        className="text-sm px-3 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        下一页 →
      </button>
    </div>
  );
}
