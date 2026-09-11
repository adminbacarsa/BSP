/**
 * Mirror de apps/web2/src/lib/dataRetention.ts — mantener alineado.
 * Política: hot = mes actual + 2 cerrados; online = 12 meses; cold = resto.
 */

export type ArchiveTier = 'hot' | 'warm' | 'cold';

export const HOT_CLOSED_MONTHS = 2;
export const ONLINE_MONTHS_SPAN = 12;

export type YearMonth = { year: number; month: number };

export function toYearMonth(d: Date): YearMonth {
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function addCalendarMonths(ym: YearMonth, delta: number): YearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

export function calendarMonthBounds(ym: YearMonth): { start: Date; end: Date } {
  return {
    start: new Date(ym.year, ym.month - 1, 1, 0, 0, 0, 0),
    end: new Date(ym.year, ym.month, 0, 23, 59, 59, 999),
  };
}

export function hotYearMonths(now = new Date()): YearMonth[] {
  const cur = toYearMonth(now);
  const out: YearMonth[] = [];
  for (let i = HOT_CLOSED_MONTHS; i >= 0; i -= 1) {
    out.push(addCalendarMonths(cur, -i));
  }
  return out;
}

export function hotWindow(now = new Date()): { start: Date; end: Date; months: YearMonth[] } {
  const months = hotYearMonths(now);
  return {
    start: calendarMonthBounds(months[0]).start,
    end: calendarMonthBounds(months[months.length - 1]).end,
    months,
  };
}

export function onlineOldestYearMonth(now = new Date()): YearMonth {
  return addCalendarMonths(toYearMonth(now), -(ONLINE_MONTHS_SPAN - 1));
}

export function classifyYearMonth(year: number, month: number, now = new Date()): ArchiveTier {
  const ym = { year, month };
  const hot = hotYearMonths(now);
  if (hot.some((h) => h.year === ym.year && h.month === ym.month)) return 'hot';
  const oldest = onlineOldestYearMonth(now);
  if (compareYearMonth(ym, oldest) >= 0) return 'warm';
  return 'cold';
}

export function classifyDate(d: Date, now = new Date()): ArchiveTier {
  return classifyYearMonth(d.getFullYear(), d.getMonth() + 1, now);
}
