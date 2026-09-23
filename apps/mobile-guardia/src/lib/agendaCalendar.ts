import type { Shift } from '@cosp/portal-types';
import {
  isAbsentLikeShift,
  isCoverageHoursOnSourceShift,
  isOperationsCoverageShift,
  toDate,
} from '@cosp/portal-core';

export type AgendaViewMode = 'day' | 'week' | 'month';

export const AGENDA_WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1, 12, 0, 0, 0);
}

/** Lunes = 0 … Domingo = 6 (Argentina). */
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function startOfWeekMonday(d: Date): Date {
  const s = startOfDay(d);
  return addDays(s, -mondayIndex(s));
}

export function formatMonthTitle(d: Date): string {
  const raw = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function formatDayTitle(d: Date): string {
  return d.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatWeekRangeTitle(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${weekStart.getDate()}–${end.getDate()} ${weekStart.toLocaleDateString('es-AR', {
      month: 'short',
      year: 'numeric',
    })}`;
  }
  return `${weekStart.getDate()} ${weekStart.toLocaleDateString('es-AR', { month: 'short' })} – ${end.getDate()} ${end.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })}`;
}

export function shiftDateKey(shift: Shift): string | null {
  const d = toDate(shift.startTime);
  return d ? toDateKey(d) : null;
}

export function groupShiftsByDateKey(shifts: Shift[]): Record<string, Shift[]> {
  const map: Record<string, Shift[]> = {};
  for (const s of shifts) {
    // Registro EXT/ADV: no aparece como turno fichable en Agenda.
    if (isCoverageHoursOnSourceShift(s as Shift & { coverageHoursOnSource?: boolean })) continue;
    const key = shiftDateKey(s);
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(s);
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => {
      const ad = toDate(a.startTime)?.getTime() ?? 0;
      const bd = toDate(b.startTime)?.getTime() ?? 0;
      return ad - bd;
    });
  }
  return map;
}

export function shiftsForDateKey(byDay: Record<string, Shift[]>, key: string): Shift[] {
  return byDay[key] ?? [];
}

export type MonthCell = {
  date: Date;
  key: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  codes: string[];
  hasEv: boolean;
  hasWork: boolean;
  hasFranco: boolean;
  hasAbsent: boolean;
  hasWorked: boolean;
};

export function isOpsCoverageShift(s: Shift): boolean {
  // Registro EXT/ADV: no se trata como cobertura fichable en Agenda.
  if (isCoverageHoursOnSourceShift(s as Shift & { coverageHoursOnSource?: boolean })) return false;
  return isOperationsCoverageShift(s);
}

/** Turnos que la Agenda muestra como trabajo/cobertura fichable (excluye registro EXT/ADV). */
export function isAgendaFichableShift(s: Shift): boolean {
  if (isCoverageHoursOnSourceShift(s as Shift & { coverageHoursOnSource?: boolean })) return false;
  if (isAgendaAbsentShift(s)) return false;
  return true;
}

export function isAgendaAbsentShift(s: Shift): boolean {
  return isAbsentLikeShift(s as unknown as Record<string, unknown>);
}

/** Retención activa: presente, no completado, esperando relevo (no es “ya trabajado”). */
export function isAgendaRetentionShift(s: Shift): boolean {
  const raw = s as Shift & { isRetention?: boolean };
  return (
    raw.isRetention === true &&
    s.isPresent === true &&
    s.isCompleted !== true &&
    !isAgendaAbsentShift(s)
  );
}

/** Turno de trabajo ya cumplido (presente, completado o horario pasado). */
export function isAgendaWorkedShift(s: Shift, now = new Date()): boolean {
  if (isAgendaAbsentShift(s)) return false;
  if (isAgendaRetentionShift(s)) return false;
  if (s.isFranco && !s.isFrancoTrabajado && !isOpsCoverageShift(s)) return false;
  if (s.isPresent === true || s.isCompleted === true) return true;
  const status = String(s.status || '').toUpperCase();
  if (
    status === 'PRESENT' ||
    status === 'COMPLETED' ||
    status === 'FINALIZED' ||
    status === 'FINALIZADO'
  ) {
    return true;
  }
  const end = toDate(s.endTime);
  if (end && end.getTime() <= now.getTime()) return true;
  return false;
}

function shiftCodeLabel(s: Shift): string {
  if (isAgendaAbsentShift(s)) {
    const code = String(s.code || '').trim().toUpperCase();
    if (code && code !== 'AA') return `AA`;
    return 'AA';
  }
  // Cobertura ops: siempre el código de banda (T/M/…), nunca como franco.
  if (isOpsCoverageShift(s)) {
    return String(s.code || 'T').toUpperCase().slice(0, 3);
  }
  if (s.isFrancoTrabajado || String(s.code || '').toUpperCase() === 'FT') return 'FT';
  if (s.isFranco) return 'F';
  if (s.eventoId || String(s.code || '').toUpperCase() === 'EV') return 'EV';
  return String(s.code || 'T').toUpperCase().slice(0, 3);
}

/** Grilla 6×7 empezando en lunes, anclada al mes de `anchor`. */
export function buildMonthCells(
  anchor: Date,
  byDay: Record<string, Shift[]>,
  today = new Date(),
): MonthCell[] {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeekMonday(monthStart);
  const todayKey = toDateKey(today);
  const cells: MonthCell[] = [];

  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const key = toDateKey(date);
    const dayShifts = byDay[key] ?? [];
    const codes = [...new Set(dayShifts.map(shiftCodeLabel))].slice(0, 3);
    const hasAbsent = dayShifts.some(isAgendaAbsentShift);
    const hasWorked = dayShifts.some((s) => isAgendaWorkedShift(s, today));
    cells.push({
      date,
      key,
      inCurrentMonth: date.getMonth() === anchor.getMonth(),
      isToday: key === todayKey,
      codes,
      hasEv: dayShifts.some((s) => !!s.eventoId || String(s.code || '').toUpperCase() === 'EV'),
      hasWork: dayShifts.some(
        (s) =>
          !isAgendaAbsentShift(s) &&
          (isOpsCoverageShift(s) || !s.isFranco || !!s.isFrancoTrabajado),
      ),
      hasFranco: dayShifts.some(
        (s) =>
          !!s.isFranco &&
          !isOpsCoverageShift(s) &&
          !s.isFrancoTrabajado &&
          !isAgendaAbsentShift(s),
      ),
      hasAbsent,
      hasWorked,
    });
  }

  return cells;
}

export function weekDaysFrom(selected: Date): Date[] {
  const start = startOfWeekMonday(selected);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Color de acento del día en la grilla (prioridad: ausencia → EV → trabajado → trabajo → franco). */
export function agendaDayAccent(
  cell: Pick<MonthCell, 'hasAbsent' | 'hasEv' | 'hasWorked' | 'hasWork' | 'hasFranco'>,
  palette: {
    warning: string;
    primary: string;
    success: string;
    error?: string;
  },
): string {
  if (cell.hasAbsent) return palette.error || '#b45309';
  if (cell.hasEv) return palette.warning;
  if (cell.hasWorked) return '#64748b';
  if (cell.hasWork) return palette.primary;
  if (cell.hasFranco) return palette.success;
  return 'transparent';
}
