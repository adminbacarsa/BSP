/**
 * Horas planificadas de la malla publicada. Una sola regla para Planificación,
 * Estado de cronogramas, Banco de Horas, CRM y Análisis.
 *
 * Entra: turno de trabajo del puesto (M/T/N/M1/D12/N12 y equivalentes) con la
 * jornada del horario; FT con jornada real de 8 o 12 h (un día calendario no es 24 h);
 * turno sin código con su horario, marcado SIN_CODIGO.
 * No entra: franco, licencia, RET, REF, ESC, ops_cov / origen operativo, vacante,
 * ni un turno creado por cobertura (FT Demo/Ops, franco convertido). Un turno de
 * malla que Operaciones solo resolvió o marcó ausente sigue en el plan.
 */

const EXCLUDED_CODES = new Set([
  'F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'AA', 'ART', 'PG', 'SUS', 'SGS', 'RET', 'REF', 'ESC', 'EV', 'EVT',
]);

const OPERATIONAL_ORIGINS = new Set([
  'RETEN', 'OPERATIONS_COVERAGE', 'SLA_VIRTUAL', 'SLA_UNPLANNED_GAP',
  'VACANTE_CORRECCION', 'VACANTE_POR_AUSENCIA', 'SIN_COBERTURA', 'INTERRUPTION',
]);

const CODE_FALLBACK: Record<string, number> = {
  M: 8, T: 8, N: 8, M1: 10, D12: 12, N12: 12, PU: 12, EN: 9, C: 8, GU: 8, RFZ: 8, TURA: 8,
};

export type PublishedPlanCodeRow = { count: number; hours: number };

export type PublishedPlanHours = {
  hours: number;
  byCode: Record<string, PublishedPlanCodeRow>;
  uncodedCount: number;
  uncodedHours: number;
  ftCount: number;
  ftHours: number;
};

function r1(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function toMs(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const o = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof o.toDate === 'function') {
    const d = o.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  const sec = o.seconds ?? o._seconds;
  if (typeof sec === 'number' && sec > 0) return sec * 1000;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

function clockHours(shift: any): number {
  const a = toMs(shift?.startTime);
  const b = toMs(shift?.endTime);
  if (a == null || b == null || a === b) return 0;
  let dur = (b - a) / 3600000;
  if (dur <= 0) dur += 24;
  if (dur > 24) dur = 24;
  return Math.round(dur * 100) / 100;
}

/** 8 o 12. Un marcador de día completo (≈24 h) no es una jornada. */
function jornadaOchoDoce(dur: number): number {
  if (dur >= 20) return 8;
  if (dur >= 10 && dur <= 16) return 12;
  if (dur >= 6) return 8;
  return dur > 0 ? 8 : 0;
}

function codeOf(shift: any): string {
  return String(shift?.code || shift?.type || '').trim().toUpperCase();
}

function isFt(shift: any, code: string): boolean {
  return code === 'FT' || shift?.isFrancoTrabajado === true || String(shift?.type || '').toUpperCase() === 'EXTRA_FRANCO';
}

/**
 * Nacido de cobertura (doc nuevo o franco convertido a FT). `resolvedBy: OPERACIONES`
 * en un turno de malla no alcanza: ese caso lo resolvió Operaciones, no lo creó.
 */
function createdByCoverage(shift: any, code: string): boolean {
  const ft = isFt(shift, code);
  const comments = String(shift?.comments || '');
  const coverageDocId = String(shift?.coverageDocId || '').trim();
  if (coverageDocId && ft) return true;
  if (/franco trabajado\s*\(cobertura/i.test(comments)) return true;
  const resolved = String(shift?.resolvedBy || '').trim().toUpperCase();
  if ((resolved === 'MODO_DEMO' || resolved === 'AUTO') && ft) return true;
  const createdBy = String(shift?.createdBy || '').trim().toUpperCase();
  if ((createdBy === 'MODO_DEMO' || createdBy === 'AUTO') && ft) return true;
  const convocatoria = String(
    shift?.assignedByConvocatoria || shift?.convocatoriaId || shift?.coverageFor || shift?.coverageForShiftId || '',
  ).trim();
  return Boolean(convocatoria) && ft;
}

function excludedShift(shift: any, opts?: { onlyDraft?: boolean; anyDraftState?: boolean }): boolean {
  if (!shift || shift.isDeleted === true) return true;
  const status = String(shift.status || '').toUpperCase();
  if (status === 'SUPERSEDED' || status.includes('CANCEL') || status.includes('DELET')) return true;
  if (!opts?.anyDraftState) {
    if (opts?.onlyDraft) {
      if (shift.draft !== true) return true;
    } else if (shift.draft === true) return true;
  }
  const origin = String(shift.origin || '').trim().toUpperCase();
  if (OPERATIONAL_ORIGINS.has(origin)) return true;
  if (shift.isReten === true) return true;
  if (String(shift.id || '').startsWith('ops_cov')) return true;
  const code = codeOf(shift);
  if (createdByCoverage(shift, code)) return true;
  if (code && EXCLUDED_CODES.has(code) && !isFt(shift, code)) return true;
  return false;
}

function hoursOf(shift: any): { key: string; hours: number } | null {
  const code = codeOf(shift);
  const dur = clockHours(shift);
  if (isFt(shift, code)) {
    const hs = jornadaOchoDoce(dur || Number(shift.hours) || 0);
    return hs > 0 ? { key: 'FT', hours: hs } : null;
  }
  if (!code) {
    const hs = dur >= 20 ? 8 : (dur >= 0.5 ? Math.min(dur, 16) : 0);
    return hs > 0 ? { key: 'SIN_CODIGO', hours: r1(hs) } : null;
  }
  const fromClock = dur >= 0.5 && dur <= 16 ? dur : 0;
  const hs = fromClock || CODE_FALLBACK[code] || 8;
  return { key: code, hours: r1(hs) };
}

export function sumPublishedPlanHours(
  turnos: any[] | null | undefined,
  opts?: { onlyDraft?: boolean; anyDraftState?: boolean },
): PublishedPlanHours {
  const byCode: Record<string, PublishedPlanCodeRow> = {};
  let hours = 0;
  let uncodedCount = 0;
  let uncodedHours = 0;
  let ftCount = 0;
  let ftHours = 0;
  for (const shift of turnos || []) {
    if (excludedShift(shift, opts)) continue;
    const part = hoursOf(shift);
    if (!part || !(part.hours > 0)) continue;
    const row = byCode[part.key] || { count: 0, hours: 0 };
    row.count += 1;
    row.hours = r1(row.hours + part.hours);
    byCode[part.key] = row;
    hours = r1(hours + part.hours);
    if (part.key === 'SIN_CODIGO') {
      uncodedCount += 1;
      uncodedHours = r1(uncodedHours + part.hours);
    }
    if (part.key === 'FT') {
      ftCount += 1;
      ftHours = r1(ftHours + part.hours);
    }
  }
  return { hours: r1(hours), byCode, uncodedCount, uncodedHours, ftCount, ftHours };
}
