/**
 * Períodos de horas — no mezclar.
 *
 * - Liquidación (libro PERSONA, Reportes, payrollApi): ciclo CCT 26→25.
 * - Prefactura (libro PUESTO), SLA vendido y KPIs: mes calendario 1→fin.
 *
 * El libro guarda detalle POR DÍA. El doc id puede ser el mes calendario
 * (`yyyy-mm`), pero no es un total cerrado: la liquidación lee dos docs
 * (26..fin del mes anterior + 1..25 del actual).
 *
 * `calculateLiquidationHoursStats` no recibe el ciclo. El llamador filtra
 * los días (o turnos) al rango y recién ahí llama a la calculadora.
 */
import {
  cctPayrollPeriodForClosingMonth,
  type CctPayrollPeriod,
} from '@/lib/cctPayrollPeriod';

export type HoursPeriodKind = 'LIQUIDACION_CCT' | 'CALENDARIO';

export type YmdRange = { start: string; end: string };

export type CalendarMonthDocSlice = {
  /** Doc id de mes calendario: yyyy-mm */
  docId: string;
  year: number;
  month: number;
  fromDay: number;
  toDay: number;
};

export type HoursFreeze =
  | { kind: 'LIQUIDACION_CCT'; cycleId: string }
  | { kind: 'CALENDARIO'; monthId: string };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function calendarMonthId(year: number, month1to12: number): string {
  return `${year}-${pad2(month1to12)}`;
}

export function daysInCalendarMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/** Mes calendario 1 → último día. Prefactura, SLA, KPIs. */
export function calendarMonthRange(year: number, month1to12: number): YmdRange {
  const last = daysInCalendarMonth(year, month1to12);
  return {
    start: `${calendarMonthId(year, month1to12)}-01`,
    end: `${calendarMonthId(year, month1to12)}-${pad2(last)}`,
  };
}

/** Ciclo CCT cuyo cierre es `closingYear`-`closingMonth` (el mes del día 25). */
export function liquidationCycleRange(closingYear: number, closingMonth: number): CctPayrollPeriod {
  return cctPayrollPeriodForClosingMonth(closingYear, closingMonth);
}

export function parseMonthId(monthId: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * Docs de mes calendario que hay que abrir para un ciclo 26→25.
 * Ej. cierre 2026-10 → `2026-09` días 26..fin + `2026-10` días 1..25.
 */
export function liquidationCalendarDocSlices(closingYear: number, closingMonth: number): CalendarMonthDocSlice[] {
  const period = liquidationCycleRange(closingYear, closingMonth);
  const start = parseMonthId(period.start.slice(0, 7));
  const end = parseMonthId(period.end.slice(0, 7));
  if (!start || !end) return [];
  const startDay = Number(period.start.slice(8, 10));
  const endDay = Number(period.end.slice(8, 10));
  return [
    {
      docId: calendarMonthId(start.year, start.month),
      year: start.year,
      month: start.month,
      fromDay: startDay,
      toDay: daysInCalendarMonth(start.year, start.month),
    },
    {
      docId: calendarMonthId(end.year, end.month),
      year: end.year,
      month: end.month,
      fromDay: 1,
      toDay: endDay,
    },
  ];
}

export function ymdInRange(ymd: string, range: YmdRange): boolean {
  const d = ymd.slice(0, 10);
  return d >= range.start && d <= range.end;
}

export function ymdInDocSlice(ymd: string, slice: CalendarMonthDocSlice): boolean {
  const d = ymd.slice(0, 10);
  if (!d.startsWith(slice.docId)) return false;
  const day = Number(d.slice(8, 10));
  return day >= slice.fromDay && day <= slice.toDay;
}

export type DayHours = { ymd: string; hours: number };

/** Suma días que caen en el rango. No lee un "total del mes" guardado. */
export function sumDayHoursInRange(days: DayHours[], range: YmdRange): number {
  let total = 0;
  for (const row of days) {
    if (ymdInRange(row.ymd, range)) total += row.hours;
  }
  return Math.round(total * 10) / 10;
}

export function sumDayHoursForLiquidation(
  days: DayHours[],
  closingYear: number,
  closingMonth: number,
): number {
  const slices = liquidationCalendarDocSlices(closingYear, closingMonth);
  let total = 0;
  for (const row of days) {
    if (slices.some((s) => ymdInDocSlice(row.ymd, s))) total += row.hours;
  }
  return Math.round(total * 10) / 10;
}

export function freezeKey(freeze: HoursFreeze): string {
  if (freeze.kind === 'LIQUIDACION_CCT') return `liquidacion:${freeze.cycleId}`;
  return `calendario:${freeze.monthId}`;
}

/** Cerrar un ciclo 26→25 no congela el mes calendario, ni al revés. */
export function freezesBlockEachOther(a: HoursFreeze, b: HoursFreeze): boolean {
  return a.kind === b.kind && freezeKey(a) === freezeKey(b);
}
