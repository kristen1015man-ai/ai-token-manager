/**
 * 公共时间范围工具
 * 支持：day / 7d / 30d / year / YYYY-MM（历史月份）
 */

export interface TimeRange {
  start: number;   // unix 秒
  end?: number;    // unix 秒，仅历史月份需要
  label: string;   // 人类可读标签
}

export function getTimeRange(range: string): TimeRange {
  const now = new Date();

  // 历史月份格式：YYYY-MM
  if (/^\d{4}-\d{2}$/.test(range)) {
    const [y, m] = range.split("-").map(Number);
    const start = Math.floor(new Date(y, m - 1, 1).getTime() / 1000);
    const end = Math.floor(new Date(y, m, 1).getTime() / 1000);
    return { start, end, label: `${y}年${m}月` };
  }

  switch (range) {
    case "day":
      return {
        start: Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000),
        label: "今日",
      };
    case "7d":
      return {
        start: Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime() / 1000),
        label: "近7天",
      };
    case "30d":
      return {
        start: Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime() / 1000),
        label: "近30天",
      };
    case "year":
      return {
        start: Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000),
        label: "今年",
      };
    default:
      return {
        start: Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime() / 1000),
        label: "近30天",
      };
  }
}

/** 生成最近 12 个月的历史月份列表（不含当月） */
export function generateHistoryMonths(count = 12): { value: string; label: string }[] {
  const now = new Date();
  const months: { value: string; label: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ value: val, label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
  }
  return months;
}

/** 判断 range 是否为历史月份格式 */
export function isHistoricalMonth(range: string): boolean {
  return /^\d{4}-\d{2}$/.test(range);
}
