import type { Timestamp } from 'firebase-admin/firestore';

/** Piso de llegada: aunque la ETA sea menor, se espera hasta T+30. */
export const LATE_ABSENCE_FLOOR_MS = 30 * 60 * 1000;
/** Tope de aviso y de reversión. Pasado esto, la ausencia abre vacante. */
export const LATE_ABSENCE_CAP_MS = 60 * 60 * 1000;

/** AA automática que todavía no abre vacante ni cascada. */
export const PROVISIONAL_LATE_REASONS = new Set(['AUTO_T30', 'ETA_VENCIDA']);

export function shiftStartMs(shift: Record<string, unknown>): number {
  const st = shift.startTime as Timestamp | { toMillis?: () => number } | undefined;
  return st?.toMillis?.() ?? 0;
}

/**
 * Deadline de AA provisoria: max(T+30, min(ETA, T+60)).
 * Sin ETA queda en T+30. Espejo en ops-core `resolveLateAbsenceDeadlineMs`
 * y en portal-core `lateEtaDeadlineMs`.
 */
export function lateAbsenceDeadlineMs(plannedStartMs: number, etaAtMs: number): number {
  if (plannedStartMs <= 0) return 0;
  const floor = plannedStartMs + LATE_ABSENCE_FLOOR_MS;
  const cap = plannedStartMs + LATE_ABSENCE_CAP_MS;
  if (etaAtMs > 0) return Math.max(floor, Math.min(etaAtMs, cap));
  return floor;
}

export function isProvisionalLateAbsence(shift: Record<string, unknown>, nowMs: number): boolean {
  const absent = shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
  if (!absent) return false;
  const by = String(shift.absenceDetectedBy || '').toUpperCase();
  if (!PROVISIONAL_LATE_REASONS.has(by)) return false;
  const start = shiftStartMs(shift);
  if (start <= 0) return false;
  return nowMs < start + LATE_ABSENCE_CAP_MS;
}

/**
 * Vacante y cascada: el operador declaró (MANUAL_OPS) o se cumplió T+60
 * de una AA provisoria. Otros motivos siguen el trigger al marcarse.
 */
export function lateVacancyDue(shift: Record<string, unknown>, nowMs: number): boolean {
  const absent = shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
  if (!absent) return false;
  if (shift.absenceVacancyOpenedAt) return false;
  const by = String(shift.absenceDetectedBy || '').toUpperCase();
  const start = shiftStartMs(shift);
  const operatorDeclared =
    by === 'MANUAL_OPS'
    || String(shift.absenceType || '').toUpperCase() === 'MANUAL_OPS'
    || !!shift.absenceConfirmedBy;
  if (operatorDeclared) return true;
  if (PROVISIONAL_LATE_REASONS.has(by)) {
    return start > 0 && nowMs >= start + LATE_ABSENCE_CAP_MS;
  }
  return false;
}
