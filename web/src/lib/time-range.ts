import {
  beijingStartOfDayUnix,
  beijingStartOfMonthUnix,
  beijingStartOfYearUnix,
  beijingWallTimeToUnixSeconds,
  getBeijingDateParts,
} from "./beijing-time";

export interface TimeRange {
  start: number;
  end?: number;
  label: string;
}

export function getTimeRange(range: string): TimeRange {
  if (/^\d{4}-\d{2}$/.test(range)) {
    const [year, month] = range.split("-").map(Number);
    return {
      start: beijingWallTimeToUnixSeconds(year, month, 1),
      end: beijingWallTimeToUnixSeconds(year, month + 1, 1),
      label: `${year}年${month}月`,
    };
  }

  switch (range) {
    case "day":
      return {
        start: beijingStartOfDayUnix(),
        end: beijingStartOfDayUnix(new Date(), 1),
        label: "今日",
      };
    case "7d":
      return {
        start: beijingStartOfDayUnix(new Date(), -6),
        end: beijingStartOfDayUnix(new Date(), 1),
        label: "近7天",
      };
    case "30d":
      return {
        start: beijingStartOfDayUnix(new Date(), -29),
        end: beijingStartOfDayUnix(new Date(), 1),
        label: "近30天",
      };
    case "year":
      return {
        start: beijingStartOfYearUnix(),
        label: "今年",
      };
    default:
      return {
        start: beijingStartOfDayUnix(new Date(), -29),
        end: beijingStartOfDayUnix(new Date(), 1),
        label: "近30天",
      };
  }
}

export function generateHistoryMonths(count = 12): { value: string; label: string }[] {
  const now = getBeijingDateParts();
  const months: { value: string; label: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const shifted = new Date(Date.UTC(now.year, now.month - 1 - i, 1));
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth() + 1;
    const value = `${year}-${String(month).padStart(2, "0")}`;
    months.push({ value, label: `${year}年${month}月` });
  }
  return months;
}

export function isHistoricalMonth(range: string): boolean {
  return /^\d{4}-\d{2}$/.test(range);
}

export function getBeijingMonthStartUnix(date = new Date()): number {
  return beijingStartOfMonthUnix(date);
}
