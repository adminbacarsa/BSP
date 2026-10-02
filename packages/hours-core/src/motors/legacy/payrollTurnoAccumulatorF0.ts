const PAID_LEAVE = new Set(['V', 'L', 'PG', 'E', 'A']);
const ZERO_HOUR_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'PG', 'A', 'E', 'AA', 'RET']);
const SHIFT_HOURS_FALLBACK: Record<string, number> = {
  M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, GU: 8, FT: 8, EN: 9, RO: 10, EV: 8,
};

export function tsToDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    const s = Number((val as { seconds: number }).seconds);
    if (Number.isFinite(s)) return new Date(s * 1000);
  }
  if (typeof val === 'object' && val !== null && '_seconds' in val) {
    const s = Number((val as { _seconds: number })._seconds);
    if (Number.isFinite(s)) return new Date(s * 1000);
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    return new Date(val > 1e12 ? val : val * 1000);
  }
  if (typeof val === 'string') {
    const s = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(`${s}T00:00:00.000-03:00`);
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** YYYY-MM-DD en calendario Argentina. */
export function dateKeyAR(d: Date): string {
  const ar = new Date(d.getTime() - 3 * 3600 * 1000);
  const y = ar.getUTCFullYear();
  const m = String(ar.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ar.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Horas nocturnas 21:00–06:00 en reloj Argentina. */
export function getNightDuration(start: Date, end: Date): number {
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  if (end.getTime() <= start.getTime()) return 0;
  let mins = 0;
  const cur = new Date(start.getTime());
  const endMs = end.getTime();
  let safety = 0;
  while (cur.getTime() < endMs && safety < 2880) {
    const arH = new Date(cur.getTime() - 3 * 3600 * 1000).getUTCHours();
    if (arH >= 21 || arH < 6) mins++;
    cur.setMinutes(cur.getMinutes() + 1);
    safety++;
  }
  return mins / 60;
}

export function clampStart(real: Date, plan: Date, tolMin = 5): Date {
  return (real.getTime() - plan.getTime()) / 60000 <= tolMin ? plan : real;
}

export function clampEnd(real: Date, plan: Date, tolMin = 5): Date {
  return Math.abs((real.getTime() - plan.getTime()) / 60000) <= tolMin ? plan : real;
}

export type PayrollTurnoAccumCtx = {
  hoursMode: 'planned' | 'real';
  holidays: Set<string>;
  turnoId?: string;
};

export type PayrollTurnoContribution = {
  hsTeoricas: number;
  hsReales: number;
  diurnas: number;
  nocturnas: number;
  al100FT: number;
  plusFeriado: number;
  warnings: string[];
  /** Si el turno no aporta jornada (zero hours, sin fichada en real, etc.) */
  skipped: boolean;
};

export function accumulatePayrollTurnoContribution(
  data: Record<string, unknown>,
  ctx: PayrollTurnoAccumCtx,
): PayrollTurnoContribution {
  const empty: PayrollTurnoContribution = {
    hsTeoricas: 0,
    hsReales: 0,
    diurnas: 0,
    nocturnas: 0,
    al100FT: 0,
    plusFeriado: 0,
    warnings: [],
    skipped: true,
  };

  const docId = ctx.turnoId ?? String(data.id ?? 'turno');
  const codeRaw = String(data.code || '').trim().toUpperCase();
  const code = codeRaw.includes('/') ? codeRaw.split('/')[0] : codeRaw;
  const status = String(data.status || '').toUpperCase();
  if (status === 'CANCELED' || status === 'CANCELLED') return empty;

  let start = tsToDate(data.startTime);
  let end = tsToDate(data.endTime);
  if ((!start || !end) && data.scheduleDate) {
    const ds = String(data.scheduleDate).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
      const h = SHIFT_HOURS_FALLBACK[code] ?? 8;
      if (!start) start = new Date(`${ds}T07:00:00.000-03:00`);
      if (!end) end = new Date(start.getTime() + h * 3600000);
    }
  }
  if (!start || !end) {
    return {
      ...empty,
      warnings: [`Turno ${docId} sin startTime/endTime válidos.`],
    };
  }

  const isFT = data.isFrancoTrabajado === true || code === 'FT' || codeRaw === 'FT';
  const isAbsent =
    ctx.hoursMode !== 'planned' && (
      data.isAbsent === true ||
      status === 'ABSENT' ||
      (status === '' && code === 'AA')
    );
  const isUnjustAbsent = !PAID_LEAVE.has(code) && isAbsent;
  const zeroHours = (!isFT && ZERO_HOUR_CODES.has(code)) || isUnjustAbsent;

  let plannedDur = 0;
  if (!zeroHours || isFT) {
    const hoursField = Number(data.hours);
    if (Number.isFinite(hoursField) && hoursField > 0 && hoursField <= 24) {
      plannedDur = hoursField;
    } else {
      plannedDur = Math.max(0, (end.getTime() - start.getTime()) / 3600000);
      if (plannedDur === 0 || plannedDur > 24 || isNaN(plannedDur)) {
        plannedDur = SHIFT_HOURS_FALLBACK[code] ?? 8;
      }
    }
  }

  const hsTeoricas = !isFT ? plannedDur : 0;
  if (zeroHours && !isFT) {
    return { ...empty, hsTeoricas, skipped: true };
  }

  let workStart: Date;
  let workEnd: Date;
  let workDur: number;

  if (ctx.hoursMode === 'planned') {
    workStart = start;
    workEnd = end;
    workDur = plannedDur;
  } else {
    const rStartRaw = tsToDate(data.realStartTime) ?? tsToDate(data.checkInTime);
    const rEndRaw = tsToDate(data.realEndTime) ?? tsToDate(data.checkOutTime);
    const rStart = rStartRaw ? clampStart(rStartRaw, start, 5) : null;
    const rEnd = rEndRaw ? clampEnd(rEndRaw, end, 5) : null;
    let rDur: number | null = null;
    if (rStart && rEnd) {
      const rd = (rEnd.getTime() - rStart.getTime()) / 3600000;
      if (rd >= 0 && rd <= 36) rDur = rd;
    }
    if (rDur == null) {
      return {
        ...empty,
        hsTeoricas,
        warnings: [
          `Turno ${docId} (${codeRaw} ${dateKeyAR(start)}) sin fichada - no suma a Hs Reales.`,
        ],
      };
    }
    workStart = rStart!;
    workEnd = rEnd!;
    workDur = rDur;
  }

  const night = getNightDuration(workStart, workEnd);
  const day = Math.max(0, workDur - night);
  const plusFeriado = holidaysHas(ctx.holidays, start) ? workDur : 0;

  if (isFT) {
    return {
      hsTeoricas: 0,
      hsReales: 0,
      diurnas: 0,
      nocturnas: 0,
      al100FT: workDur,
      plusFeriado: 0,
      warnings: [],
      skipped: false,
    };
  }

  return {
    hsTeoricas,
    hsReales: workDur,
    diurnas: day,
    nocturnas: night,
    al100FT: 0,
    plusFeriado,
    warnings: [],
    skipped: false,
  };
}

function holidaysHas(holidays: Set<string>, start: Date): boolean {
  return holidays.has(dateKeyAR(start));
}
