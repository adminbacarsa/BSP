/** Calendario mensual VPLAN (zona AR para letras de día). */

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

export function dateKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getDayLetter(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  const dow = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  return DAY_LETTERS[dow] ?? 'L';
}

export function buildMonthDays(year: number, month: number): Array<{ dateStr: string; dayLetter: string }> {
  const last = new Date(year, month, 0).getDate();
  const days: Array<{ dateStr: string; dayLetter: string }> = [];
  for (let d = 1; d <= last; d++) {
    const dateStr = dateKeyFromParts(year, month, d);
    days.push({ dateStr, dayLetter: getDayLetter(dateStr) });
  }
  return days;
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  if (month <= 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}
