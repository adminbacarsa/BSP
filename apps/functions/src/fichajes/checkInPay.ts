/** Tolerancia de pago del titular: hasta T+5 el reloj es el inicio planificado. */

export const PAY_ON_TIME_GRACE_MS = 5 * 60 * 1000;

export type CheckInPayClock = {
  /** Hora real de la fichada (auditoría). Siempre `now`. */
  checkInAtMs: number;
  /** Inicio que liquida: planificado si fichó hasta T+5; la fichada desde T+6. */
  realStartMs: number;
  isLate: boolean;
  lateMinutes: number;
};

export function resolveCheckInPayClock(input: {
  nowMs: number;
  plannedStartMs: number;
  windowLateMinutes?: number;
}): CheckInPayClock {
  const nowMs = input.nowMs;
  const plannedStartMs = input.plannedStartMs;
  const pastGrace = plannedStartMs > 0 && nowMs > plannedStartMs + PAY_ON_TIME_GRACE_MS;
  const lateFromClock = plannedStartMs > 0
    ? Math.max(0, Math.round((nowMs - plannedStartMs) / 60000))
    : 0;
  const windowLate = Math.max(0, input.windowLateMinutes ?? 0);
  return {
    checkInAtMs: nowMs,
    realStartMs: pastGrace || !plannedStartMs ? nowMs : plannedStartMs,
    isLate: pastGrace,
    lateMinutes: pastGrace ? Math.max(lateFromClock, windowLate) : 0,
  };
}
