import { Timestamp } from 'firebase-admin/firestore';

const ZERO_HOUR_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'PG', 'A', 'E', 'AA', 'RET']);
const PAID_LEAVE = new Set(['V', 'L', 'PG', 'E', 'A']);
const TRUE_NON_WORK = new Set(['F', 'FF', 'FP', 'AA', 'FT']);

function tsToDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate();
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    const s = Number((val as { seconds: number }).seconds);
    if (Number.isFinite(s)) return new Date(s * 1000);
  }
  return null;
}

const dateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const getNightDuration = (start: Date, end: Date): number => {
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 0;
  let mins = 0;
  const cur = new Date(start.getTime());
  const endMs = end.getTime();
  let safety = 0;
  while (cur.getTime() < endMs && safety < 2880) {
    const h = cur.getHours();
    if (h >= 21 || h < 6) mins++;
    cur.setMinutes(cur.getMinutes() + 1);
    safety++;
  }
  return mins / 60;
};

const clampStart = (real: Date, plan: Date, tolMin = 5): Date =>
  (real.getTime() - plan.getTime()) / 60000 <= tolMin ? plan : real;

const clampEnd = (real: Date, plan: Date, tolMin = 5): Date =>
  Math.abs((real.getTime() - plan.getTime()) / 60000) <= tolMin ? plan : real;

export type TurnoHoursContrib = {
  hsTeoricas: number;
  hsReales: number;
  diurnas: number;
  nocturnas: number;
  al100FT: number;
  plusFeriado: number;
  isFT: boolean;
  monthKey: string;
};

export function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function calcTurnoHoursContrib(
  data: Record<string, unknown>,
  holidays: Set<string> = new Set(),
): TurnoHoursContrib | null {
  if (data.draft === true) return null;
  if (data.isUnassigned === true) return null;
  if (data.isCompleted !== true) return null;

  const empId = String(data.employeeId ?? '').trim();
  if (!empId || empId === 'VACANTE') return null;

  const code = String(data.code ?? '').trim().toUpperCase();
  const status = String(data.status ?? '').toUpperCase();
  if (status === 'CANCELED' || status === 'CANCELLED') return null;
  if (String(data.type ?? '').toUpperCase() === 'NOVEDAD') return null;

  const startDt = tsToDate(data.startTime);
  const endDt = tsToDate(data.endTime);
  if (!startDt || !endDt) return null;

  const monthKey = monthKeyFromDate(startDt);
  const isAbsent = data.isAbsent === true || status === 'ABSENT';
  const zeroHours = TRUE_NON_WORK.has(code) || ZERO_HOUR_CODES.has(code) || (isAbsent && !PAID_LEAVE.has(code));

  let plannedDur = 0;
  if (!zeroHours) {
    plannedDur = Math.max(0, (endDt.getTime() - startDt.getTime()) / 3600000);
    if (plannedDur === 0 || plannedDur > 24 || isNaN(plannedDur)) plannedDur = 8;
  }

  const isFT = data.isFrancoTrabajado === true || code === 'FT';
  if (zeroHours) {
    return {
      hsTeoricas: 0,
      hsReales: 0,
      diurnas: 0,
      nocturnas: 0,
      al100FT: 0,
      plusFeriado: 0,
      isFT,
      monthKey,
    };
  }

  const rStartRaw = tsToDate(data.realStartTime) ?? tsToDate(data.checkInTime);
  const rEndRaw = tsToDate(data.realEndTime) ?? tsToDate(data.checkOutTime);
  const rStart = rStartRaw ? clampStart(rStartRaw, startDt, 5) : null;
  const rEnd = rEndRaw ? clampEnd(rEndRaw, endDt, 5) : null;

  if (!rStart || !rEnd) {
    return {
      hsTeoricas: plannedDur,
      hsReales: 0,
      diurnas: 0,
      nocturnas: 0,
      al100FT: 0,
      plusFeriado: 0,
      isFT,
      monthKey,
    };
  }

  const rd = (rEnd.getTime() - rStart.getTime()) / 3600000;
  if (rd < 0 || rd > 36) return null;

  const night = getNightDuration(rStart, rEnd);
  const day = Math.max(0, rd - night);
  const plusFeriado = holidays.has(dateKey(startDt)) ? rd : 0;
  const al100FT = isFT ? rd : 0;

  return {
    hsTeoricas: plannedDur,
    hsReales: rd,
    diurnas: day,
    nocturnas: night,
    al100FT,
    plusFeriado,
    isFT,
    monthKey,
  };
}
