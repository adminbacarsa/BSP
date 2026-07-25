export const ALL_WEEK_DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

export type PlanningPositionShiftRow = {
  code: string;
  hours: number;
  name?: string;
  startTime?: string;
  endTime?: string;
  days?: string[];
  specificDates?: string[];
  [key: string]: unknown;
};

export function normalizeDayLetters(days: unknown): string[] {
  if (!Array.isArray(days)) return [];
  return days
    .map((d) => String(d ?? '').trim().toUpperCase())
    .filter((d) => (ALL_WEEK_DAY_LETTERS as readonly string[]).includes(d));
}

function collectShiftDaysUnion(shifts: Array<{ days?: string[] }>): string[] {
  const set = new Set<string>();
  for (const s of shifts) {
    for (const d of normalizeDayLetters(s.days)) set.add(d);
  }
  return ALL_WEEK_DAY_LETTERS.filter((d) => set.has(d));
}

/** Días operativos del puesto: prioriza activeDays explícito; si no, unión de shift.days. */
export function derivePlanningPositionActiveDays(
  posActiveDays: string[] | undefined,
  shifts: Array<{ days?: string[] }>,
): string[] {
  const shiftUnion = collectShiftDaysUnion(shifts);
  const posDays = normalizeDayLetters(posActiveDays);

  if (posDays.length > 0 && posDays.length < 7) {
    if (shiftUnion.length > 0) return posDays.filter((d) => shiftUnion.includes(d));
    return posDays;
  }

  if (shiftUnion.length > 0 && shiftUnion.length < 7) return shiftUnion;

  if (posDays.length > 0) return posDays;
  return [...ALL_WEEK_DAY_LETTERS];
}

export function formatPositionActiveDaysLabel(activeDays?: string[]): string {
  const days = normalizeDayLetters(activeDays);
  if (days.length === 0 || days.length >= 7) return 'L–D';
  if (days.join('') === 'LMXJV') return 'L–V';
  if (days.join('') === 'SD') return 'S–D';
  return days.join(' ');
}

export function normalizePlanningShifts(shiftList: unknown): PlanningPositionShiftRow[] {
  if (!Array.isArray(shiftList)) return [];
  return shiftList.map((raw) => {
    const s = raw as Record<string, unknown>;
    const code = String(s.code ?? '').toUpperCase();
    const row: PlanningPositionShiftRow = {
      code,
      hours: Number(s.hours) || 8,
      name: s.name != null ? String(s.name) : undefined,
    };
    if (s.startTime != null) row.startTime = String(s.startTime);
    if (s.endTime != null) row.endTime = String(s.endTime);
    const days = normalizeDayLetters(s.days);
    if (days.length > 0) row.days = days;
    if (Array.isArray(s.specificDates) && s.specificDates.length > 0) {
      row.specificDates = s.specificDates.map((d) => String(d));
    }
    return row;
  });
}
