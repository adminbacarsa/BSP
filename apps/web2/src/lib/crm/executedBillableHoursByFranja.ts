/**
 * Horas facturables EJECUTADO / prestado OC: por franja pedida, no por reloj.
 *
 * Unidad = cada turno titular planificado (objetivo × puesto × día × banda × titular).
 * Con qty 4 en M hay 4 franjas de 8 h = 32 h pedidas.
 *   facturable de la franja = minutos de la ventana planificada con alguien en el puesto.
 * Horas pedidas = fin − inicio planificado del titular (cruza medianoche).
 * La tabla por código (M/T/N = 8) solo entra si faltan esos timestamps.
 *
 * Presencia dentro de la franja (unión, sin doble conteo), en este orden:
 * 1. Titular fichado: desde el inicio planificado (la tardanza no descuenta)
 *    hasta su salida real si se fue antes; sin salida, hasta el fin planificado.
 * 2. Cobertura (`ops_cov_*`, ausente en absenceShiftId / coveredShiftId): la
 *    intersección de su ventana planificada con la del titular, recortada a la
 *    salida real si fue anterior al fin planificado. 0 solo si nunca se presentó.
 * 3. Retenido del mismo puesto (turno marcado con retención): lo que se quedó
 *    después de su fin planificado, con tope de 12:59 h desde su ingreso.
 * 4. Relevo del mismo puesto: quien empieza su turno y llegó antes de su inicio
 *    planificado cubre desde su ingreso real.
 * Los minutos sin nadie son descubiertos.
 *
 * Adicionales al cliente (fuera de acá): RFZ, TURA, EV.
 * FT, ESC y REF no facturan al cliente. Si ESC/REF cubrieron una ausencia,
 * el doc ya es ops_cov y llena la franja del ausente; el turno ESC/REF fuente no suma.
 *
 * Canónico de prefactura (prod: Edificio 100 h, Obrador qty 4 = 32 h, Peaje 32,3 h).
 * Destino único: @cosp/hours-core, export `executedBillableHoursByFranja`
 * (ver docs/HANDOFF-HOURS-CORE-FRANJA.md). Hasta ese export, la prefactura importa desde acá.
 */
import { getDateKeyInTimezone, toDateSafe } from './crmDateUtils';
import { FICHADA_SHIFT_HOURS, isShiftAbsent, isShiftFichado } from './fichadaHours';

const ADICIONAL_CODES = new Set(['RFZ', 'TURA', 'EV']);
/** No son franjas vendidas al cliente: francos, retén, escuela y refuerzo interno. */
const NON_FRANJA_CODES = new Set(['F', 'FF', 'FP', 'RET', 'ESC', 'REF']);
const HOUR_MS = 3600000;
/** Tope de permanencia de un retenido, contado desde su ingreso. */
export const RETENTION_MAX_STINT_MS = (12 * 60 + 59) * 60000;

export type FranjaShift = {
  id?: string;
  objectiveId?: string;
  objectiveName?: string;
  positionName?: string;
  employeeId?: string;
  code?: string;
  type?: string;
  hours?: number;
  startTime?: unknown;
  endTime?: unknown;
  startDate?: string;
  scheduleDate?: string;
  planningDate?: string;
  fecha?: string;
  employeeName?: string;
  origin?: string;
  coverageType?: string;
  coverageHoursOnSource?: boolean;
  coverageSuperseded?: boolean;
  sourceShiftId?: string | null;
  absenceShiftId?: string | null;
  coveredShiftId?: string | null;
  titularShiftId?: string | null;
  isAbsent?: boolean;
  status?: string;
  isPresent?: boolean;
  isCompleted?: boolean;
  isDeleted?: boolean;
  realStartTime?: unknown;
  realEndTime?: unknown;
  checkInTime?: unknown;
  checkOutTime?: unknown;
  isRetention?: boolean;
  retentionAbsenceShiftId?: string | null;
  retentionKind?: string | null;
  retentionReleasedAt?: unknown;
  retentionEndTime?: unknown;
};

export type FranjaWindow = { start: number; end: number };

export type FranjaContributionKind = 'titular' | 'cobertura' | 'retenido' | 'relevo';

/** Quién llenó la franja y en qué tramos (ms). Sin ventana planificada del titular, `pieces` queda vacío. */
export type FranjaContribution = {
  shiftId: string;
  employeeId: string;
  employeeName: string;
  kind: FranjaContributionKind;
  hours: number;
  pieces: FranjaWindow[];
};

export type FranjaTitular = {
  shiftId: string;
  employeeId: string;
  requested: number;
  covered: number;
  billable: number;
  fromSelf: number;
  fromCoverage: number;
  fromFillers: number;
  contributions: FranjaContribution[];
};

export type FranjaBucket = {
  key: string;
  objectiveId: string;
  objectiveName: string;
  positionName: string;
  date: string;
  code: string;
  requested: number;
  covered: number;
  billable: number;
  uncovered: number;
  titulares: FranjaTitular[];
};

export type FranjaBillableResult = {
  buckets: FranjaBucket[];
  totalRequested: number;
  totalBillable: number;
  totalUncovered: number;
  byObjectiveId: Record<string, number>;
  byObjectiveName: Record<string, number>;
};

export type FranjaBillableOpts = {
  /** Solo franjas con fecha dentro del período (YYYY-MM-DD, inclusive). */
  startYmd?: string;
  endYmd?: string;
};

function codeOf(t: FranjaShift): string {
  return String(t.code || t.type || '').trim().toUpperCase();
}

function isCoverageTrace(t: FranjaShift): boolean {
  const id = String(t.id || '');
  const origin = String(t.origin || '').toUpperCase();
  return origin === 'OPERATIONS_COVERAGE' || id.startsWith('ops_cov_') || t.coverageHoursOnSource === true;
}

/** Turno del ausente al que apunta la cobertura. `sourceShiftId` es el del que cubre: no sirve acá. */
export function coverageTargetShiftId(cov: FranjaShift): string {
  return String(cov.absenceShiftId || cov.coveredShiftId || cov.titularShiftId || '').trim();
}

/** Ventana planificada. Si el fin quedó <= inicio, se asume cruce de medianoche. */
function plannedWindow(t: FranjaShift): FranjaWindow | null {
  const s = toDateSafe(t.startTime);
  const e = toDateSafe(t.endTime);
  if (!s || !e) return null;
  const start = s.getTime();
  let end = e.getTime();
  if (end <= start) end += 24 * HOUR_MS;
  const hours = (end - start) / HOUR_MS;
  if (hours <= 0 || hours > 24) return null;
  return { start, end };
}

function hoursOf(pieces: FranjaWindow[]): number {
  return pieces.reduce((a, p) => a + (p.end - p.start), 0) / HOUR_MS;
}

function mergePieces(pieces: FranjaWindow[]): FranjaWindow[] {
  const sorted = pieces.filter((p) => p.end > p.start).sort((a, b) => a.start - b.start);
  const out: FranjaWindow[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else out.push({ ...p });
  }
  return out;
}

function clipPieces(pieces: FranjaWindow[], w: FranjaWindow): FranjaWindow[] {
  return pieces
    .map((p) => ({ start: Math.max(p.start, w.start), end: Math.min(p.end, w.end) }))
    .filter((p) => p.end > p.start);
}

function subtractPieces(pieces: FranjaWindow[], taken: FranjaWindow[]): FranjaWindow[] {
  let rest = mergePieces(pieces);
  for (const t of taken) {
    const next: FranjaWindow[] = [];
    for (const p of rest) {
      if (t.end <= p.start || t.start >= p.end) {
        next.push(p);
        continue;
      }
      if (t.start > p.start) next.push({ start: p.start, end: t.start });
      if (t.end < p.end) next.push({ start: t.end, end: p.end });
    }
    rest = next;
  }
  return rest;
}

/** Horas pedidas de la franja: horario planificado; tabla por código solo si no hay timestamps. */
function requestedHours(t: FranjaShift, code: string): number {
  const w = plannedWindow(t);
  if (w) return (w.end - w.start) / HOUR_MS;
  if (FICHADA_SHIFT_HOURS[code]) return FICHADA_SHIFT_HOURS[code];
  const stored = Number(t.hours);
  if (Number.isFinite(stored) && stored > 0 && stored <= 24) return stored;
  return 8;
}

function ymdOf(t: FranjaShift): string {
  for (const field of ['scheduleDate', 'planningDate', 'fecha', 'startDate'] as const) {
    const direct = String(t[field] || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  }
  const st = toDateSafe(t.startTime);
  if (st) return getDateKeyInTimezone(st);
  return '';
}

function realStartMs(t: FranjaShift): number | null {
  const d = toDateSafe(t.realStartTime) || toDateSafe(t.checkInTime);
  return d ? d.getTime() : null;
}

function realExitMs(t: FranjaShift): number | null {
  const d = toDateSafe(t.realEndTime) || toDateSafe(t.checkOutTime);
  return d ? d.getTime() : null;
}

function covererPresented(t: FranjaShift): boolean {
  if (isShiftAbsent(t)) return false;
  if (t.isPresent === true || t.isCompleted === true) return true;
  const st = String(t.status || '').toUpperCase();
  if (st === 'PRESENT' || st === 'COMPLETED') return true;
  return realStartMs(t) != null;
}

function titularPresented(t: FranjaShift): boolean {
  if (isShiftAbsent(t)) return false;
  return isShiftFichado(t) || t.isPresent === true || t.isCompleted === true;
}

/** Desde el inicio de `w` (sin descontar tardanza) hasta la salida real si fue antes del fin. */
function presenceUntilExit(t: FranjaShift, w: FranjaWindow): FranjaWindow[] {
  const exit = realExitMs(t);
  const end = exit != null && exit < w.end ? Math.max(exit, w.start) : w.end;
  return end > w.start ? [{ start: w.start, end }] : [];
}

function coveragePieces(cov: FranjaShift, titWin: FranjaWindow): FranjaWindow[] {
  if (!covererPresented(cov)) return [];
  const covWin = plannedWindow(cov);
  if (!covWin) {
    const stored = Number(cov.hours);
    if (!Number.isFinite(stored) || stored <= 0) return [];
    return [{ start: titWin.start, end: Math.min(titWin.end, titWin.start + Math.min(stored, 24) * HOUR_MS) }];
  }
  const base = clipPieces([covWin], titWin);
  if (base.length === 0) return [];
  return clipPieces(presenceUntilExit(cov, covWin), titWin);
}

function hasRetentionMark(t: FranjaShift): boolean {
  return t.isRetention === true
    || !!String(t.retentionAbsenceShiftId || '').trim()
    || !!String(t.retentionKind || '').trim()
    || toDateSafe(t.retentionReleasedAt) != null;
}

type Filler = {
  shift: FranjaShift;
  kind: 'retenido' | 'relevo';
  available: FranjaWindow[];
};

/** Tramos fuera de la propia franja en que el guardia estuvo en el puesto: retenido (después) o relevo (antes). */
function fillersOf(t: FranjaShift): Filler[] {
  if (!covererPresented(t) || t.coverageHoursOnSource === true) return [];
  const code = codeOf(t);
  if (NON_FRANJA_CODES.has(code) || ADICIONAL_CODES.has(code)) return [];
  const own = plannedWindow(t);
  if (!own) return [];
  const out: Filler[] = [];
  const started = realStartMs(t);
  if (started != null && started < own.start) {
    out.push({ shift: t, kind: 'relevo', available: [{ start: started, end: own.start }] });
  }
  if (hasRetentionMark(t)) {
    const retEnd = toDateSafe(t.retentionEndTime);
    const stayedUntil = realExitMs(t) ?? (retEnd ? retEnd.getTime() : null);
    if (stayedUntil != null) {
      const cap = (started ?? own.start) + RETENTION_MAX_STINT_MS;
      const end = Math.min(stayedUntil, cap);
      if (end > own.end) out.push({ shift: t, kind: 'retenido', available: [{ start: own.end, end }] });
    }
  }
  return out;
}

function normName(s: string): string {
  return String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function positionKey(t: FranjaShift): string {
  return `${String(t.objectiveId || '').trim()}|${normName(String(t.positionName || 'Sin puesto'))}`;
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function executedBillableHoursByFranja(
  turnos: FranjaShift[],
  opts: FranjaBillableOpts = {},
): FranjaBillableResult {
  const live = turnos.filter((t) => t.isDeleted !== true);

  const coveragesByTarget = new Map<string, FranjaShift[]>();
  for (const cov of live) {
    if (!isCoverageTrace(cov) || cov.coverageSuperseded === true) continue;
    const target = coverageTargetShiftId(cov);
    if (!target) continue;
    const list = coveragesByTarget.get(target) || [];
    list.push(cov);
    coveragesByTarget.set(target, list);
  }
  for (const list of coveragesByTarget.values()) {
    list.sort((a, b) => (plannedWindow(a)?.start ?? 0) - (plannedWindow(b)?.start ?? 0));
  }

  const fillersByPosition = new Map<string, Filler[]>();
  for (const t of live) {
    for (const f of fillersOf(t)) {
      const k = positionKey(t);
      const list = fillersByPosition.get(k) || [];
      list.push(f);
      fillersByPosition.set(k, list);
    }
  }
  for (const list of fillersByPosition.values()) {
    list.sort((a, b) => (a.available[0]?.start ?? 0) - (b.available[0]?.start ?? 0));
  }

  const titulares = live
    .filter((t) => {
      if (isCoverageTrace(t)) return false;
      const code = codeOf(t);
      return !!code && !ADICIONAL_CODES.has(code) && !NON_FRANJA_CODES.has(code);
    })
    .sort((a, b) => (plannedWindow(a)?.start ?? 0) - (plannedWindow(b)?.start ?? 0));

  const buckets = new Map<string, FranjaBucket>();

  for (const t of titulares) {
    const code = codeOf(t);
    const date = ymdOf(t);
    if (!date) continue;
    if (opts.startYmd && date < opts.startYmd) continue;
    if (opts.endYmd && date > opts.endYmd) continue;

    const objectiveId = String(t.objectiveId || '').trim();
    const positionName = String(t.positionName || 'Sin puesto').trim();
    const requested = requestedHours(t, code);
    const key = `${objectiveId}|${normName(positionName)}|${date}|${code}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        objectiveId,
        objectiveName: String(t.objectiveName || objectiveId || 'Objetivo'),
        positionName,
        date,
        code,
        requested: 0,
        covered: 0,
        billable: 0,
        uncovered: 0,
        titulares: [],
      };
      buckets.set(key, bucket);
    }

    const shiftId = String(t.id || '');
    const contributions: FranjaContribution[] = [];
    const titWin = plannedWindow(t);
    const covs = coveragesByTarget.get(shiftId) || [];

    if (titWin) {
      let taken: FranjaWindow[] = [];
      const take = (who: FranjaShift, kind: FranjaContributionKind, pieces: FranjaWindow[]): FranjaWindow[] => {
        const fresh = subtractPieces(clipPieces(pieces, titWin), taken);
        const hours = hoursOf(fresh);
        if (hours <= 0) return [];
        contributions.push({
          shiftId: String(who.id || ''),
          employeeId: String(who.employeeId || ''),
          employeeName: String(who.employeeName || ''),
          kind,
          hours,
          pieces: fresh,
        });
        taken = mergePieces([...taken, ...fresh]);
        return fresh;
      };
      if (titularPresented(t)) take(t, 'titular', presenceUntilExit(t, titWin));
      for (const cov of covs) take(cov, 'cobertura', coveragePieces(cov, titWin));
      if (hoursOf(taken) < requested) {
        for (const f of fillersByPosition.get(positionKey(t)) || []) {
          if (f.shift === t) continue;
          const used = take(f.shift, f.kind, f.available);
          if (used.length) f.available = subtractPieces(f.available, used);
        }
      }
    } else {
      if (titularPresented(t)) {
        contributions.push({
          shiftId, employeeId: String(t.employeeId || ''), employeeName: String(t.employeeName || ''),
          kind: 'titular', hours: requested, pieces: [],
        });
      }
      let room = requested - (contributions[0]?.hours || 0);
      for (const cov of covs) {
        if (room <= 0 || !covererPresented(cov)) continue;
        const stored = Number(cov.hours);
        const hours = Math.min(room, Number.isFinite(stored) && stored > 0 ? stored : room);
        contributions.push({
          shiftId: String(cov.id || ''), employeeId: String(cov.employeeId || ''), employeeName: String(cov.employeeName || ''),
          kind: 'cobertura', hours, pieces: [],
        });
        room -= hours;
      }
    }

    const sumKind = (k: FranjaContributionKind[]) =>
      contributions.filter((c) => k.includes(c.kind)).reduce((a, c) => a + c.hours, 0);
    const fromSelf = sumKind(['titular']);
    const fromCoverage = sumKind(['cobertura']);
    const fromFillers = sumKind(['retenido', 'relevo']);
    const covered = Math.min(requested, fromSelf + fromCoverage + fromFillers);

    bucket.titulares.push({
      shiftId,
      employeeId: String(t.employeeId || ''),
      requested,
      covered,
      billable: covered,
      fromSelf,
      fromCoverage,
      fromFillers,
      contributions,
    });
    bucket.requested += requested;
    bucket.covered += covered;
    bucket.billable += covered;
    bucket.uncovered = Math.max(0, bucket.requested - bucket.covered);
  }

  const list = [...buckets.values()];
  const byObjectiveId: Record<string, number> = {};
  const byObjectiveName: Record<string, number> = {};
  let totalRequested = 0;
  let totalBillable = 0;
  for (const b of list) {
    totalRequested += b.requested;
    totalBillable += b.billable;
    if (b.objectiveId) byObjectiveId[b.objectiveId] = r1((byObjectiveId[b.objectiveId] || 0) + b.billable);
    const nk = normName(b.objectiveName);
    if (nk) byObjectiveName[nk] = r1((byObjectiveName[nk] || 0) + b.billable);
  }

  return {
    buckets: list,
    totalRequested: r1(totalRequested),
    totalBillable: r1(totalBillable),
    totalUncovered: r1(Math.max(0, totalRequested - totalBillable)),
    byObjectiveId,
    byObjectiveName,
  };
}
