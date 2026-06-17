/** 分页导航组件 — glass 风格统一 */

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

  const btnBase =
    "text-sm px-3 py-1.5 rounded-lg font-medium transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <div
      className="flex items-center justify-between rounded-xl px-4 py-3"
      style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}
    >
      <button
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className={btnBase}
        style={{ color: "var(--text-secondary)" }}
      >
        ← 上一页
      </button>
      <span className="text-sm" style={{ color: "var(--text-muted)" }}>
        第 {page + 1} / {totalPages} 页
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        className={btnBase}
        style={{ color: "var(--text-secondary)" }}
      >
        下一页 →
      </button>
    </div>
  );
}
