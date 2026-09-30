import { relieverFor, seriesBoundMs, type SeriesShift } from './shiftSeries';

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

/**
 * Texto del retenido. Antes de la hora del relevo: «Esperando relevo de las HH:MM (nombre)».
 * Pasada esa hora sin fichar: «nombre no se presentó».
 * Espejo: `apps/functions/src/scheduling/retentionPendingReason.ts`.
 */
export function retentionPendingReason(opts: {
  nowMs: number;
  reliefStartMs: number;
  employeeName: string;
}): string {
  const name = String(opts.employeeName || 'relevo').trim() || 'relevo';
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
  isPresent?: unknown;
  isCompleted?: unknown;
  isAbsent?: unknown;
  status?: unknown;
  isUnassigned?: unknown;
  retentionAbsenceShiftId?: unknown;
};

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
  // Primero quien todavía puede venir; el ausente solo si no hay otro de la serie.
  const alive = pool.filter((row) => relieverStatus(row) !== 'AUSENTE');
  const picked = linked ?? relieverFor(shift, alive) ?? relieverFor(shift, pool);

  const reliever = picked
    ? {
      id: String(picked.id || ''),
      employeeName: String(picked.employeeName || 'relevo').trim(),
      code: String(picked.code || '').trim().toUpperCase(),
      startMs: seriesBoundMs(picked, 'start'),
      status: relieverStatus(picked),
    }
    : null;

  let waitLabel: string;
  if (!reliever) {
    waitLabel = 'Sin relevo planificado → vacante';
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
