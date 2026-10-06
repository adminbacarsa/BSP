import { isOpsCoverageHoursOnSourceDoc } from './coverageSemantics';
import { isReliefEligibleShift } from './reliefEligibility';
import { SHIFT_SERIES_ALIGN_MS, relieverFor, reliefPositionsMatch, seriesBoundMs, seriesCodeOf, seriesHandoffKind, type SeriesShift } from './shiftSeries';

/** Espejo de `SHIFT_HARD_CAP_MS` (apps/functions/src/scheduling/shiftClose.ts). */
export const RETENTION_HARD_CAP_MS = (12 * 60 + 59) * 60 * 1000;

const TZ = 'America/Argentina/Buenos_Aires';

function readMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (value && typeof value === 'object') {
    const o = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
    if (typeof o.toMillis === 'function') return o.toMillis() || 0;
    if (typeof o.toDate === 'function') return o.toDate().getTime() || 0;
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

export function formatHmAR(ms: number): string {
  if (!ms) return '--:--';
  return new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TZ,
  });
}

/** Primer token del apellido: «KOPP Franco» y «KOPP, Franco» → KOPP. */
function quienCobertura(employeeName: string): string {
  const raw = String(employeeName || '').trim();
  const head = (raw.split(',')[0] || raw).trim();
  return head.split(/\s+/)[0] || 'relevo';
}

/**
 * Texto del retenido. Antes de la hora del relevo: «Esperando relevo de las HH:MM (nombre)».
 * Pasada esa hora sin fichar: «nombre no se presentó».
 * Cobertura (ops_cov, otra persona): «Esperando a KOPP (cobertura, en camino)» o «… llega HH:MM».
 * Espejo: `apps/functions/src/scheduling/retentionPendingReason.ts`.
 */
export function retentionPendingReason(opts: {
  nowMs: number;
  reliefStartMs: number;
  employeeName: string;
  /** ops_cov que toma la franja: mismo relevo, otra persona. */
  cobertura?: boolean;
  /** Llegada prevista (`expectedArrivalAt`). Si no, vale `reliefStartMs`. */
  arrivalMs?: number;
}): string {
  const name = String(opts.employeeName || 'relevo').trim() || 'relevo';
  if (opts.cobertura) {
    const who = quienCobertura(name);
    const llega = opts.arrivalMs && opts.arrivalMs > 0 ? opts.arrivalMs : opts.reliefStartMs;
    if (llega > 0 && opts.nowMs < llega) {
      return `Esperando a ${who} (cobertura, llega ${formatHmAR(llega)})`;
    }
    return `Esperando a ${who} (cobertura, en camino)`;
  }
  if (opts.reliefStartMs > 0 && opts.nowMs < opts.reliefStartMs) {
    return `Esperando relevo de las ${formatHmAR(opts.reliefStartMs)} (${name})`;
  }
  return `${name} no se presentó`;
}

/** `12 min` hasta 59; después `1 h 05 min`. Nunca negativo. */
export function formatRetentionDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${h} h ${String(rest).padStart(2, '0')} min`;
}

export type RetentionRelieverStatus = 'NO_FICHO' | 'AUSENTE' | 'PRESENTE';

export type RetentionWaitInfo = {
  /** Fin planificado: desde cuándo está retenido. */
  sinceMs: number;
  elapsedMinutes: number;
  /** Tope 12:59 desde el inicio real (o planificado). */
  capAtMs: number;
  capRemainingMinutes: number;
  reliever: {
    id: string;
    employeeName: string;
    code: string;
    startMs: number;
    status: RetentionRelieverStatus;
  } | null;
  /** Texto listo para la tarjeta: a quién espera. */
  waitLabel: string;
};

type WaitShift = SeriesShift & {
  objectiveId?: unknown;
  employeeId?: unknown;
  employeeName?: unknown;
  code?: unknown;
  positionName?: unknown;
  isPresent?: unknown;
  isCompleted?: unknown;
  isAbsent?: unknown;
  status?: unknown;
  isUnassigned?: unknown;
  manualRetentionType?: unknown;
  operacionallyCovered?: unknown;
  plannedOperativelyCovered?: unknown;
  coverageStatus?: unknown;
  retentionAbsenceShiftId?: unknown;
};

function rowIsAbsent(row: WaitShift): boolean {
  return row.isAbsent === true || String(row.status || '').toUpperCase() === 'ABSENT';
}

function rowIsCovered(row: WaitShift): boolean {
  return row.operacionallyCovered === true
    || row.plannedOperativelyCovered === true
    || String(row.coverageStatus || '').toUpperCase() === 'COVERED';
}

function apellidoDe(name: unknown): string {
  const raw = String(name || '').trim();
  const head = raw.split(',')[0]?.trim() || raw;
  return head || 'relevo';
}

/**
 * Antes del fin del saliente, si el relevo de la serie está ausente y nadie
 * ocupa esa franja: «Relevo ausente: VENENCIA (T3 16:00) · sin cubrir».
 * Con el hueco cubierto, o pasada la hora, no dice nada (ahí ya es RETENIDO).
 */
export function relevoAusenteAviso(
  shift: WaitShift,
  sameObjectiveShifts: readonly WaitShift[],
  now: Date | number,
): string | null {
  if (shift.isPresent !== true || shift.isCompleted === true || shift.manualRetentionType) return null;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const endMs = seriesBoundMs(shift, 'end');
  if (!endMs || nowMs >= endMs) return null;
  const oid = String(shift.objectiveId || '').trim();
  const pool = sameObjectiveShifts.filter((row) => {
    if (!row || row === shift) return false;
    if (row.id && shift.id && String(row.id) === String(shift.id)) return false;
    if (oid && String(row.objectiveId || '').trim() !== oid) return false;
    return true;
  });
  const absent = pool.filter((row) => {
    if (!rowIsAbsent(row) || rowIsCovered(row)) return false;
    if (!reliefPositionsMatch(row.positionName, shift.positionName)) return false;
    const start = seriesBoundMs(row, 'start');
    if (!start || Math.abs(start - endMs) > SHIFT_SERIES_ALIGN_MS) return false;
    if (seriesHandoffKind(seriesCodeOf(shift), seriesCodeOf(row)) === 'REJECT') return false;
    const coveredByAssignment = pool.some((other) => {
      if (other === row || String(other.id || '') === String(row.id || '')) return false;
      if (rowIsAbsent(other) || other.isCompleted === true || other.isUnassigned === true) return false;
      const employeeId = String(other.employeeId || '').trim();
      if (!employeeId || employeeId === 'VACANTE') return false;
      if (!isReliefEligibleShift(other)) return false;
      if (!reliefPositionsMatch(other.positionName, row.positionName)) return false;
      const their = seriesCodeOf(other);
      const gapCode = seriesCodeOf(row);
      if (gapCode && their && their !== gapCode) return false;
      const otherStart = seriesBoundMs(other, 'start');
      return otherStart > 0 && Math.abs(otherStart - start) <= SHIFT_SERIES_ALIGN_MS;
    });
    return !coveredByAssignment;
  });
  const linkedId = String(shift.retentionAbsenceShiftId || '').trim();
  const picked = (linkedId ? absent.find((row) => String(row.id || '') === linkedId) : undefined) ?? absent[0];
  if (!picked) return null;
  const code = String(picked.code || seriesCodeOf(picked) || '').trim().toUpperCase();
  const hm = formatHmAR(seriesBoundMs(picked, 'start'));
  const slot = [code, hm].filter(Boolean).join(' ');
  return `Relevo ausente: ${apellidoDe(picked.employeeName)} (${slot}) · sin cubrir`;
}

function workStartMs(shift: WaitShift): number {
  return readMs(shift.realStartTime) || readMs(shift.checkInTime) || readMs(shift.checkInAt) || seriesBoundMs(shift, 'start');
}

function relieverStatus(row: WaitShift): RetentionRelieverStatus {
  if (row.isAbsent === true || String(row.status || '').toUpperCase() === 'ABSENT') return 'AUSENTE';
  if (row.isPresent === true || String(row.status || '').toUpperCase() === 'PRESENT') return 'PRESENTE';
  return 'NO_FICHO';
}

function isPlannedPerson(row: WaitShift): boolean {
  const eid = String(row.employeeId || '').trim();
  if (!eid || eid === 'VACANTE') return false;
  if (row.isUnassigned === true) return false;
  if (row.isCompleted === true) return false;
  return true;
}

/**
 * Qué espera un saliente retenido o con el fin vencido: el relevo de la serie
 * (P5g) entre los turnos del mismo objetivo, o vacante si nadie viene.
 */
export function buildRetentionWaitInfo(
  shift: WaitShift,
  sameObjectiveShifts: readonly WaitShift[],
  now: Date | number,
): RetentionWaitInfo | null {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const sinceMs = seriesBoundMs(shift, 'end');
  if (!sinceMs) return null;
  const elapsedMinutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60000));
  const start = workStartMs(shift);
  const capAtMs = start > 0 ? start + RETENTION_HARD_CAP_MS : 0;
  const capRemainingMinutes = capAtMs > 0 ? Math.max(0, Math.floor((capAtMs - nowMs) / 60000)) : 0;

  const oid = String(shift.objectiveId || '').trim();
  const pool = sameObjectiveShifts.filter((row) => {
    if (!row || row === shift) return false;
    if (row.id && shift.id && String(row.id) === String(shift.id)) return false;
    if (oid && String(row.objectiveId || '').trim() !== oid) return false;
    return isPlannedPerson(row);
  });

  const linkedId = String(shift.retentionAbsenceShiftId || '').trim();
  const linked = linkedId ? pool.find((row) => String(row.id || '') === linkedId) : undefined;
  // Los otros salientes de la misma franja (presentes, mismo puesto, fin ±30 min): el
  // emparejamiento es FIFO entre todos ellos, así la tarjeta muestra lo que va a pasar.
  const peers = pool.filter((row) =>
    relieverStatus(row) === 'PRESENTE'
    && !readMs(row.realEndTime)
    && isReliefEligibleShift(row)
    && reliefPositionsMatch(row.positionName, shift.positionName)
    && Math.abs(seriesBoundMs(row, 'end') - sinceMs) <= SHIFT_SERIES_ALIGN_MS);
  const incomings = pool.filter((row) => !peers.includes(row));
  // Primero quien todavía puede venir; el ausente solo si no hay otro de la serie.
  const alive = incomings.filter((row) => relieverStatus(row) !== 'AUSENTE');
  const picked = relieverFor(shift, alive, { peers, roster: sameObjectiveShifts })
    ?? relieverFor(shift, incomings, { peers, roster: sameObjectiveShifts })
    ?? linked
    ?? null;

  const reliever = picked
    ? {
      id: String(picked.id || ''),
      employeeName: String(picked.employeeName || 'relevo').trim(),
      code: String(picked.code || '').trim().toUpperCase(),
      startMs: seriesBoundMs(picked, 'start'),
      status: relieverStatus(picked),
    }
    : null;

  const cobertura = !!picked
    && !isOpsCoverageHoursOnSourceDoc(picked)
    && String(picked.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';
  let waitLabel: string;
  if (!reliever) {
    waitLabel = 'Sin relevo planificado → vacante';
  } else if (cobertura && reliever.status !== 'PRESENTE') {
    waitLabel = retentionPendingReason({
      nowMs,
      reliefStartMs: reliever.startMs,
      employeeName: reliever.employeeName,
      cobertura: true,
      arrivalMs: readMs(picked?.expectedArrivalAt),
    });
  } else {
    const who = `${reliever.employeeName}${reliever.code ? ` (${reliever.code} ${formatHmAR(reliever.startMs)})` : ` (${formatHmAR(reliever.startMs)})`}`;
    waitLabel = reliever.status === 'AUSENTE'
      ? `Relevo ausente: ${who} → espera cubridor`
      : reliever.status === 'PRESENTE'
        ? `Relevo ${who} ya fichó · cierre en curso`
        : retentionPendingReason({
          nowMs,
          reliefStartMs: reliever.startMs,
          employeeName: reliever.employeeName,
        });
  }

  return { sinceMs, elapsedMinutes, capAtMs, capRemainingMinutes, reliever, waitLabel };
}

/** Línea completa: «Retenido desde 15:00 · 12 min · Espera a LOPEZ (T 15:00) · tope 00:29 (9 h 23 min)». */
export function formatRetentionLine(info: RetentionWaitInfo | null | undefined): string | null {
  if (!info) return null;
  const parts = [
    `Retenido desde ${formatHmAR(info.sinceMs)}`,
    formatRetentionDuration(info.elapsedMinutes),
    info.waitLabel,
  ];
  if (info.capAtMs > 0) {
    parts.push(`tope ${formatHmAR(info.capAtMs)} (${formatRetentionDuration(info.capRemainingMinutes)})`);
  }
  return parts.join(' · ');
}
