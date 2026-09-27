import { Timestamp } from 'firebase-admin/firestore';

/** Tope de jornada CCT: nadie supera 12 h; tolerancia de relevo hasta 12:59, nunca 13 h. */
export const SHIFT_HARD_CAP_MS = (12 * 60 + 59) * 60 * 1000;

/** Cierres por tope que llegan tarde (cron caído, turnos viejos abiertos): se marcan para revisión. */
export const STALE_CAP_GRACE_MS = 2 * 60 * 60 * 1000;

type TsLike = { toMillis?: () => number } | undefined | null;

const ms = (v: unknown): number => (v as TsLike)?.toMillis?.() ?? 0;

/** Inicio de jornada: fichada real; si no fichó, inicio planificado. */
export function shiftWorkStartMs(data: Record<string, unknown>): number {
  return ms(data.realStartTime) || ms(data.checkInTime) || ms(data.presenciaAt) || ms(data.startTime);
}

export function shiftHardCapAtMs(data: Record<string, unknown>): number {
  const start = shiftWorkStartMs(data);
  return start > 0 ? start + SHIFT_HARD_CAP_MS : 0;
}

export type AutoCloseOpts = {
  realEndMs: number;
  reason: string;
  now: Timestamp;
  by?: string;
  extra?: Record<string, unknown>;
};

/**
 * Parche de cierre automático: siempre con `realEndTime` (acotado al tope) y, si estaba retenido,
 * `retentionMinutes` para que Liquidación compute la salida real aunque luego se toque `isRetention`.
 */
export function buildAutoClosePatch(
  data: Record<string, unknown>,
  opts: AutoCloseOpts,
): Record<string, unknown> {
  const capAt = shiftHardCapAtMs(data);
  const endMs = capAt > 0 ? Math.min(opts.realEndMs, capAt) : opts.realEndMs;
  const realEnd = Timestamp.fromMillis(endMs);
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
  const plannedEnd = ms(data.endTime);
  if (data.isRetention === true) {
    patch.retentionEndedAt = realEnd;
    if (plannedEnd > 0 && endMs > plannedEnd) {
      patch.retentionMinutes = Math.round((endMs - plannedEnd) / 60000);
    }
  }
  return patch;
}
