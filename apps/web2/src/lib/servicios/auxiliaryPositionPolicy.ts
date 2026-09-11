import type { ServicePosition } from '@/services/slaService';
import { isEncargadoCoverageType, isEncargadoPosition, hoursBetweenHm } from '@/lib/servicios/encargadoPosition';
import { isEventosCoverageType, isEventosPosition } from '@/lib/servicios/eventosPosition';

export type EncargadoScheduleMode = 'fixed' | 'rotating';
export type WorkPatternId = '6x2' | '5x1' | '4x12' | '6x1';

export const WORK_PATTERN_OPTIONS: Array<{ id: WorkPatternId; label: string; workDays: number; cycleDays: number }> = [
  { id: '6x2', label: '6×2 (6 trabajo + 2 franco)', workDays: 6, cycleDays: 8 },
  { id: '5x1', label: '5×1 (5 trabajo + 1 franco)', workDays: 5, cycleDays: 6 },
  { id: '6x1', label: '6×1 (6 trabajo + 1 franco)', workDays: 6, cycleDays: 7 },
  { id: '4x12', label: '4×12 (4 turnos × 12 h / ciclo)', workDays: 4, cycleDays: 7 },
];

export function isAuxiliaryCoveragePosition(pos: Pick<ServicePosition, 'coverageType' | 'code' | 'name'> | null | undefined): boolean {
  if (!pos) return false;
  return isEncargadoPosition(pos) || isEventosPosition(pos);
}

/** Eventos nunca suman SLA de cobertura. Encargado depende del switch (default: fijo=ON, rotativo=OFF). */
export function positionIncludeInSlaTotals(pos: ServicePosition | null | undefined): boolean {
  if (!pos) return true;
  if (isEventosCoverageType(pos.coverageType) || isEventosPosition(pos)) return false;
  if (typeof pos.includeInSlaTotals === 'boolean') return pos.includeInSlaTotals;
  if (isEncargadoCoverageType(pos.coverageType) || isEncargadoPosition(pos)) {
    const mode = resolveEncargadoScheduleMode(pos);
    return mode === 'fixed';
  }
  return true;
}

export function resolveEncargadoScheduleMode(pos: ServicePosition): EncargadoScheduleMode {
  if (pos.encargadoScheduleMode === 'rotating' || pos.encargadoScheduleMode === 'fixed') {
    return pos.encargadoScheduleMode;
  }
  return 'fixed';
}

export function resolveEncargadoHoursPerDay(pos: ServicePosition): number {
  const fromField = Number(pos.workPatternHoursPerDay);
  if (Number.isFinite(fromField) && fromField > 0) return fromField;
  const enc = (pos.allowedShiftTypes || []).find((s) => String(s.code || '').toUpperCase() === 'ENC');
  if (enc?.hours && Number(enc.hours) > 0) return Number(enc.hours);
  if (enc?.startTime && enc?.endTime) {
    const h = hoursBetweenHm(String(enc.startTime), String(enc.endTime));
    if (h > 0) return h;
  }
  return 8;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function countDaysInRange(start: Date, end: Date): number {
  if (end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function parseYmd(s: string): Date | null {
  const raw = String(s || '').trim().slice(0, 10);
  const [y, mo, d] = raw.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const dt = new Date(y, mo - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function overlapRange(
  contractStart: string,
  contractEnd: string,
  year: number,
  month: number,
): { from: Date; to: Date; days: number } | null {
  const mStart = new Date(year, month, 1);
  const mEnd = new Date(year, month + 1, 0);
  const cStart = parseYmd(contractStart);
  const cEnd = parseYmd(contractEnd);
  if (!cStart || !cEnd) return null;
  const from = cStart > mStart ? cStart : mStart;
  const to = cEnd < mEnd ? cEnd : mEnd;
  if (from > to) return null;
  return { from, to, days: countDaysInRange(from, to) };
}

/** Jornadas efectivas en el mes según patrón rotativo (6×2, 5×1…). */
export function workShiftsInMonthForPattern(
  patternId: WorkPatternId | string | undefined,
  year: number,
  month: number,
  effectiveDaysInMonth?: number,
): number {
  const def = WORK_PATTERN_OPTIONS.find((p) => p.id === patternId) || WORK_PATTERN_OPTIONS[0];
  const dim = effectiveDaysInMonth ?? daysInMonth(year, month);
  const cycles = dim / def.cycleDays;
  return Math.round(cycles * def.workDays * 10) / 10;
}

/** Horas contractuales mensuales de encargado rotativo (patrón × hs/día). */
export function encargadoRotatingPatternMonthHours(
  pos: ServicePosition,
  contractStart: string,
  contractEnd: string,
  year: number,
  month: number,
): number {
  const range = overlapRange(contractStart, contractEnd, year, month);
  if (!range) return 0;
  const pattern = (pos.workPattern as WorkPatternId) || '6x2';
  const shifts = workShiftsInMonthForPattern(pattern, year, month, range.days);
  const hDay = resolveEncargadoHoursPerDay(pos);
  return Math.round(shifts * hDay * 10) / 10;
}

export function filterPositionsForSlaTotals(positions: ServicePosition[]): ServicePosition[] {
  return (positions || []).filter((p) => positionIncludeInSlaTotals(p));
}

export type MonthAuxiliaryHoursSplit = {
  slaCoverageHours: number;
  encargadoContractHours: number;
  includedEncargadoInSla: number;
};

/** SLA vendidas del mes: cobertura + encargado solo si includeInSlaTotals. */
export function resolveMonthSlaVendidasSplit(
  positions: ServicePosition[],
  contractStart: string,
  contractEnd: string,
  excludedDates: string[] | undefined,
  year: number,
  month: number,
  calendarDayHours: (pos: ServicePosition) => number,
): MonthAuxiliaryHoursSplit {
  let slaCoverageHours = 0;
  let encargadoContractHours = 0;
  let includedEncargadoInSla = 0;

  for (const pos of positions || []) {
    if (!pos) continue;
    const isEnc = isEncargadoPosition(pos);
    const isEvt = isEventosPosition(pos);
    if (isEvt) continue;

    if (isEnc) {
      const mode = resolveEncargadoScheduleMode(pos);
      const include = positionIncludeInSlaTotals(pos);
      let contract = 0;
      if (mode === 'rotating') {
        contract = encargadoRotatingPatternMonthHours(pos, contractStart, contractEnd, year, month);
      } else {
        contract = calendarDayHours(pos);
      }
      encargadoContractHours += contract;
      if (include) includedEncargadoInSla += contract;
      continue;
    }

    if (positionIncludeInSlaTotals(pos)) {
      slaCoverageHours += calendarDayHours(pos);
    }
  }

  return {
    slaCoverageHours: Math.round(slaCoverageHours * 10) / 10,
    encargadoContractHours: Math.round(encargadoContractHours * 10) / 10,
    includedEncargadoInSla: Math.round(includedEncargadoInSla * 10) / 10,
  };
}
