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
