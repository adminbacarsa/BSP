import type { Timestamp } from 'firebase-admin/firestore';

/** Piso de llegada: aunque la ETA sea menor, se espera hasta T+30. */
export const LATE_ABSENCE_FLOOR_MS = 30 * 60 * 1000;
/** Tope para revertir y, si avisó, para abrir la vacante. La ETA que se acepta es 30 min. */
export const LATE_ETA_MAX_MINUTES = 30;

export function clampLateEtaMinutes(raw: unknown, fallback = LATE_ETA_MAX_MINUTES): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(LATE_ETA_MAX_MINUTES, Math.max(1, Math.floor(n)));
}

/** Tope de reversión (y de vacante si avisó). */
export const LATE_ABSENCE_CAP_MS = 60 * 60 * 1000;

/** Quien avisó: AA sin vacante hasta T+60. Sin aviso (AUTO_T30) abre vacante al momento. */
export const PROVISIONAL_LATE_REASONS = new Set(['ETA_VENCIDA']);
/** Las dos se revierten al fichar hasta T+60, aunque la sin aviso ya tenga vacante. */
export const REVERSIBLE_LATE_REASONS = new Set(['AUTO_T30', 'ETA_VENCIDA']);

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

function absentBeforeCap(shift: Record<string, unknown>, nowMs: number, reasons: Set<string>): boolean {
  const absent = shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
  if (!absent) return false;
  const by = String(shift.absenceDetectedBy || '').toUpperCase();
  if (!reasons.has(by)) return false;
  const start = shiftStartMs(shift);
  if (start <= 0) return false;
  return nowMs < start + LATE_ABSENCE_CAP_MS;
}

/** Solo quien avisó llegada tarde: sin vacante ni cascada hasta T+60. */
export function isProvisionalLateAbsence(shift: Record<string, unknown>, nowMs: number): boolean {
  return absentBeforeCap(shift, nowMs, PROVISIONAL_LATE_REASONS);
}

/** Fichada o LLEGÓ? revierten AUTO_T30 y ETA_VENCIDA hasta T+60. */
export function isReversibleLateAbsence(shift: Record<string, unknown>, nowMs: number): boolean {
  return absentBeforeCap(shift, nowMs, REVERSIBLE_LATE_REASONS);
}

/**
 * Vacante: sin aviso (AUTO_T30) en el momento; con aviso al T+60; o si el operador declara.
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
  if (by === 'AUTO_T30') return true;
  if (PROVISIONAL_LATE_REASONS.has(by)) {
    return start > 0 && nowMs >= start + LATE_ABSENCE_CAP_MS;
  }
  return false;
}
