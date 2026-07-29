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

const DEFAULT_PLANNING_SHIFT_META: Record<string, { name: string; startTime: string; endTime: string; hours: number }> = {
  M: { name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8 },
  T: { name: 'Tarde', startTime: '15:00', endTime: '23:00', hours: 8 },
  N: { name: 'Noche', startTime: '23:00', endTime: '07:00', hours: 8 },
  D12: { name: 'Diurno 12h', startTime: '07:00', endTime: '19:00', hours: 12 },
  N12: { name: 'Nocturno 12h', startTime: '19:00', endTime: '07:00', hours: 12 },
};

function parseClockToHours(t: string): number | null {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return +m[1] + +m[2] / 60;
}

/** Horas de un turno según SLA (hours explícito o duración start–end). */
export function resolvePlanningShiftHours(shift: PlanningPositionShiftRow): number {
  const stored = Number(shift.hours);
  if (stored > 0) return stored;
  if (typeof shift.startTime === 'string' && typeof shift.endTime === 'string') {
    const s = parseClockToHours(shift.startTime);
    const e = parseClockToHours(shift.endTime);
    if (s !== null && e !== null) {
      let dur = e - s;
      if (dur <= 0) dur += 24;
      if (dur > 0 && dur <= 24) return Math.round(dur * 10) / 10;
    }
  }
  return DEFAULT_PLANNING_SHIFT_META[String(shift.code || '').toUpperCase()]?.hours ?? 8;
}

/** Rango horario legible (ej. 08:00–20:00). */
export function formatPlanningShiftScheduleLabel(shift: PlanningPositionShiftRow): string {
  if (typeof shift.startTime === 'string' && typeof shift.endTime === 'string') {
    return `${shift.startTime}–${shift.endTime}`;
  }
  const def = DEFAULT_PLANNING_SHIFT_META[String(shift.code || '').toUpperCase()];
  if (def) return `${def.startTime}–${def.endTime}`;
  return '—';
}

export function resolvePlanningShiftName(shift: PlanningPositionShiftRow): string {
  const code = String(shift.code || '').toUpperCase();
  const name = String(shift.name || '').trim();
  if (name && name.toUpperCase() !== code) return name;
  return DEFAULT_PLANNING_SHIFT_META[code]?.name || code;
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
