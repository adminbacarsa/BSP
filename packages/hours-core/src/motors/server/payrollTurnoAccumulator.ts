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

/** @deprecated Fase 0 ±5 min. El libro persona no lo usa. */
export function clampStart(real: Date, plan: Date, tolMin = 5): Date {
  return (real.getTime() - plan.getTime()) / 60000 <= tolMin ? plan : real;
}

/** @deprecated Fase 0 ±5 min. El libro persona no lo usa. */
export function clampEnd(real: Date, plan: Date, tolMin = 5): Date {
  return Math.abs((real.getTime() - plan.getTime()) / 60000) <= tolMin ? plan : real;
}

/** Inicio: banda planificada, salvo adelanto autorizado. */
export function personaClampStart(real: Date, plan: Date, earlyAuthorized: boolean): Date {
  return earlyAuthorized ? real : plan;
}

/**
 * Fin: banda planificada; relevo anticipado completa la jornada; retención formal usa el reloj;
 * extensión autorizada suma solo lo trabajado hasta su fin.
 */
export function personaClampEnd(real: Date, plan: Date, retention: boolean, authorizedEnd?: Date | null): Date {
  if (!plan || isNaN(plan.getTime())) return real;
  if (real.getTime() < plan.getTime()) return plan;
  if (retention) return real;
  if (authorizedEnd && authorizedEnd.getTime() > plan.getTime()) {
    return real.getTime() < authorizedEnd.getTime() ? real : authorizedEnd;
  }
  return plan;
}

function authorizedExtensionEnd(data: Record<string, unknown>, plannedEnd: Date): Date | null {
  const role = String(data.coverageSegmentRole || '').toUpperCase();
  if (data.isExtended !== true && role !== 'EXTENSION') return null;
  const raw = data.adjustedEndTime || data.extensionEndTime || data.segmentToTime;
  const m = String(raw || '').trim().slice(0, 5).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const ymd = dateKeyAR(plannedEnd);
  let out = new Date(`${ymd}T${m[1].padStart(2, '0')}:${m[2]}:00.000-03:00`);
  if (out.getTime() <= plannedEnd.getTime()) out = new Date(out.getTime() + 24 * 3600000);
  if (out.getTime() - plannedEnd.getTime() > 12 * 3600000) return null;
  return out;
}

export type PersonaHoursBreakdown = {
  totales: number;
  plan: number;
  ext: number;
  adv: number;
  cobertura: number;
  ft: number;
  tura: number;
  planificadas: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyBreakdown(planificadas = 0): PersonaHoursBreakdown {
  return {
    totales: 0,
    plan: 0,
    ext: 0,
    adv: 0,
    cobertura: 0,
    ft: 0,
    tura: 0,
    planificadas,
  };
}

function breakdownForWorked(
  data: Record<string, unknown>,
  code: string,
  worked: number,
  plannedDur: number,
  isFT: boolean,
): PersonaHoursBreakdown {
  const planificadas = isFT ? 0 : plannedDur;
  if (worked <= 0) return emptyBreakdown(planificadas);
  if (isFT) {
    return { ...emptyBreakdown(0), totales: worked, ft: worked, planificadas: 0 };
  }
  if (code === 'TURA' || code === 'RFZ') {
    return { ...emptyBreakdown(planificadas), totales: worked, tura: worked };
  }
  const origin = String(data.origin || '').toUpperCase();
  const coverageType = String(data.coverageType || '').toUpperCase();
  const isCobertura = origin === 'OPERATIONS_COVERAGE'
    && data.coverageHoursOnSource !== true
    && coverageType !== 'EXTEND'
    && coverageType !== 'ADVANCE';
  if (isCobertura) {
    return { ...emptyBreakdown(planificadas), totales: worked, cobertura: worked };
  }
  const band = SHIFT_HOURS_FALLBACK[code] ?? plannedDur;
  const planPart = Math.min(worked, band > 0 ? band : worked);
  const extra = round2(Math.max(0, worked - planPart));
  const early = data.isEarlyStart === true || String(data.coverageSegmentRole || '').toUpperCase() === 'EARLY_START';
  const extended = data.isExtended === true
    || data.isRetention === true
    || String(data.coverageSegmentRole || '').toUpperCase() === 'EXTENSION';
  if (early && extra > 0) {
    return { ...emptyBreakdown(planificadas), totales: worked, plan: planPart, adv: extra };
  }
  if (extended && extra > 0) {
    return { ...emptyBreakdown(planificadas), totales: worked, plan: planPart, ext: extra };
  }
  return { ...emptyBreakdown(planificadas), totales: worked, plan: worked };
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
  desglose: PersonaHoursBreakdown;
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
    desglose: emptyBreakdown(),
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
    return { ...empty, hsTeoricas, skipped: true, desglose: emptyBreakdown(hsTeoricas) };
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
    const earlyAuthorized = data.isEarlyStart === true
      || String(data.coverageSegmentRole || '').toUpperCase() === 'EARLY_START';
    const retention = data.isRetention === true || Number(data.retentionMinutes ?? 0) > 0;
    const rStart = rStartRaw ? personaClampStart(rStartRaw, start, earlyAuthorized) : null;
    const rEnd = rEndRaw ? personaClampEnd(rEndRaw, end, retention, authorizedExtensionEnd(data, end)) : null;
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
          `Turno ${docId} (${codeRaw} ${dateKeyAR(start)}) sin fichada — no suma a Hs Reales.`,
        ],
        desglose: emptyBreakdown(hsTeoricas),
      };
    }
    workStart = rStart!;
    workEnd = rEnd!;
    workDur = rDur;
  }

  const night = getNightDuration(workStart, workEnd);
  const day = Math.max(0, workDur - night);
  const plusFeriado = holidaysHas(ctx.holidays, start) ? workDur : 0;
  const desglose = breakdownForWorked(data, code, workDur, plannedDur, isFT);

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
      desglose,
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
    desglose,
  };
}

function holidaysHas(holidays: Set<string>, start: Date): boolean {
  return holidays.has(dateKeyAR(start));
}
