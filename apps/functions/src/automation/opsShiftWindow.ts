import { Timestamp } from 'firebase-admin/firestore';

/**
 * Espejo server-side de `useOperacionesMonitor.isOpsShiftHoy` (ventana CC, no solo día calendario).
 * Mantener alineado con apps/web2/src/hooks/useOperacionesMonitor.ts
 */
export const OPS_PLAN_LOOKAHEAD_MS = 16 * 60 * 60 * 1000;
export const OPS_ZOMBIE_PRESENT_MAX_MS = 48 * 60 * 60 * 1000;

export type TurnoLike = Record<string, unknown>;

function turnoTimestamp(row: TurnoLike, key: string): Timestamp | null {
  const value = row[key];
  return value instanceof Timestamp ? value : null;
}

function normalizeCode(row: TurnoLike): string {
  return String(row.code ?? '').trim().toUpperCase();
}

function isRestFrancoShift(row: TurnoLike): boolean {
  if (!row || row.isFrancoTrabajado === true) return false;
  const code = normalizeCode(row);
  if (code === 'F' || code === 'FF' || code === 'FP') return true;
  if (row.isFrancoCompensatorio === true) return true;
  if (row.isFranco === true || row.objectiveName === 'FRANCO') return true;
  return false;
}

function arYmdFromDate(d: Date): string {
  const msAr = d.getTime() - 3 * 60 * 60 * 1000;
  return new Date(msAr).toISOString().slice(0, 10);
}

function arYmdFromTimestamp(ts: Timestamp): string {
  return arYmdFromDate(ts.toDate());
}

/** Límites de query Firestore que cubren toda la ventana operativa del monitor. */
export function opsMonitorQueryWindow(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(now.getTime() - OPS_ZOMBIE_PRESENT_MAX_MS),
    end: new Date(now.getTime() + OPS_PLAN_LOOKAHEAD_MS),
  };
}

export function isOpsShiftHoyServer(row: TurnoLike, now: Date): boolean {
  if (row.isCompleted === true && row.isReten !== true && !isRestFrancoShift(row)) {
    return false;
  }

  const start = turnoTimestamp(row, 'startTime');
  const end = turnoTimestamp(row, 'endTime');
  if (!start) return false;

  if (row.isVirtual === true && end) {
    if (
      arYmdFromTimestamp(start) !== arYmdFromDate(now) &&
      end.toMillis() < now.getTime()
    ) {
      return false;
    }
  }

  const nowMs = now.getTime();
  const startMs = start.toMillis();
  let endMs = end?.toMillis() ?? 0;
  if (startMs > 0 && endMs > 0 && endMs <= startMs) endMs += 86400000;

  if (arYmdFromTimestamp(start) === arYmdFromDate(now)) return true;

  if (
    (row.isPresent === true || row.isReten === true || row.isRetention === true) &&
    row.isCompleted !== true
  ) {
    return startMs > 0 && nowMs - startMs <= OPS_ZOMBIE_PRESENT_MAX_MS;
  }

  if (startMs > 0 && endMs > nowMs && startMs <= nowMs) return true;

  if (startMs > nowMs && startMs - nowMs <= OPS_PLAN_LOOKAHEAD_MS) return true;

  return false;
}
