const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const BEIJING_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface BeijingDateParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

export function getBeijingDateParts(date = new Date()): BeijingDateParts {
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

export function beijingWallTimeToUnixSeconds(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): number {
  return Math.floor((Date.UTC(year, month - 1, day, hour, minute, second, 0) - BEIJING_OFFSET_MS) / 1000);
}

export function beijingStartOfDayUnix(date = new Date(), dayOffset = 0): number {
  const parts = getBeijingDateParts(date);
  return beijingWallTimeToUnixSeconds(parts.year, parts.month, parts.day + dayOffset);
}

export function beijingStartOfMonthUnix(date = new Date(), monthOffset = 0): number {
  const parts = getBeijingDateParts(date);
  return beijingWallTimeToUnixSeconds(parts.year, parts.month + monthOffset, 1);
}

export function beijingStartOfYearUnix(date = new Date()): number {
  const parts = getBeijingDateParts(date);
  return beijingWallTimeToUnixSeconds(parts.year, 1, 1);
}

export function beijingCurrentMonthLabel(date = new Date()): string {
  const parts = getBeijingDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

export function beijingRemainingDaysInMonth(date = new Date()): number {
  const parts = getBeijingDateParts(date);
  const nextMonthStart = beijingWallTimeToUnixSeconds(parts.year, parts.month + 1, 1);
  const todayStart = beijingWallTimeToUnixSeconds(parts.year, parts.month, parts.day);
  return Math.max(0, Math.ceil((nextMonthStart - todayStart) / 86400) - 1);
}

export function formatBeijingDateTime(date = new Date()): string {
  const parts = BEIJING_TIME_FORMATTER.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} 北京时间`;
}
