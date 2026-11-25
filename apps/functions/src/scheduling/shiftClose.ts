import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  SHIFT_HARD_CAP_MS,
  STALE_CAP_GRACE_MS,
  computeShiftCloseTimes,
  shiftHardCapAtMs,
  shiftWorkStartMs,
} from './shiftCloseCore';

export { SHIFT_HARD_CAP_MS, STALE_CAP_GRACE_MS, shiftHardCapAtMs, shiftWorkStartMs };

export type AutoCloseOpts = {
  realEndMs: number;
  reason: string;
  now: Timestamp;
  by?: string;
  extra?: Record<string, unknown>;
};

/**
 * Parche de cierre autom?tico: siempre con `realEndTime` (acotado al tope) y, si estaba retenido,
 * `retentionMinutes` para que Liquidaci?n compute la salida real aunque luego se toque `isRetention`.
 * El c?lculo vive en `shiftCloseCore` (mismo m?dulo que usa el CHECKOUT del operador en el front).
 */
/**
 * Cierra tramos de un cortado que tienen ingreso y siguen sin egreso, para que Liquidación
 * no deje el día en Pendiente cuando el cron completa el turno.
 */
function patchPresenciaBloquesAlCerrar(
  data: Record<string, unknown>,
  realEnd: Timestamp,
): Record<string, unknown> {
  const pb = data.presenciaBloques;
  if (!pb || typeof pb !== 'object') return {};
  const extra: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(pb as Record<string, Record<string, unknown> | null | undefined>)) {
    if (!raw || typeof raw !== 'object') continue;
    if (!raw.realStartTime) continue;
    if (raw.realEndTime || raw.cerrado === true) continue;
    extra[`presenciaBloques.${key}.realEndTime`] = realEnd;
    extra[`presenciaBloques.${key}.cerrado`] = true;
  }
  return extra;
}

export function buildAutoClosePatch(
  data: Record<string, unknown>,
  opts: AutoCloseOpts,
): Record<string, unknown> {
  const times = computeShiftCloseTimes(data, opts.realEndMs);
  const realEnd = Timestamp.fromMillis(times.realEndMs);
  const patch: Record<string, unknown> = {
    status: 'COMPLETED',
    isCompleted: true,
    isPresent: false,
    realEndTime: realEnd,
    completedAt: opts.now,
    completedBy: 'Sistema',
    autoCompletedAt: opts.now,
    autoCompletedBy: opts.by || 'SYSTEM_SCHEDULER',
    autoCloseReason: opts.reason,
    completionReason: opts.reason,
    ...patchPresenciaBloquesAlCerrar(data, realEnd),
    ...(opts.extra || {}),
  };
  if (times.retentionEndedMs != null) {
    patch.retentionEndedAt = Timestamp.fromMillis(times.retentionEndedMs);
    if (times.retentionMinutes != null) patch.retentionMinutes = times.retentionMinutes;
  }
  return patch;
}

/** Cierre por relevo: la jornada retenida queda en minutos y fin; el flag ya no sigue activo. */
export function clearRetentionOnReliefClose(patch: Record<string, unknown>): Record<string, unknown> {
  patch.isRetention = false;
  patch.retentionReason = FieldValue.delete();
  return patch;
}
