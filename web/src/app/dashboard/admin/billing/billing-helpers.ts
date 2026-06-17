/** 账单分析页 — 格式化工具 */

export const RANGE_LABELS: Record<string, string> = {
  day: "今日",
  "7d": "近7天",
  "30d": "近30天",
  year: "今年",
};

export function getRangeLabel(range: string): string {
  if (/^\d{4}-\d{2}$/.test(range)) {
    const [y, m] = range.split("-");
    return `${y}年${parseInt(m!)}月`;
  }
  return RANGE_LABELS[range] || "近30天";
}

export function fmt(n: number): string {
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}K`
      : String(n);
}
