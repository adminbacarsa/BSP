import { Timestamp } from 'firebase-admin/firestore';
import { isOpsCoverageHoursOnSourceDoc } from '../coverage/coverageTraceShift';

export type CheckInWindowResult = {
  allowed: boolean;
  rejectCode?: 'ABSENT' | 'TRACE_REGISTRATION' | 'TOO_EARLY' | 'TOO_LATE' | 'SHIFT_ENDED';
  /** Si allowed: hora planificada vs real para realStartTime */
  usePlannedStart?: boolean;
  lateMinutes?: number;
};

function startMs(shift: Record<string, unknown>): number {
  return (shift.startTime as Timestamp | undefined)?.toMillis?.() ?? 0;
}

function endMs(shift: Record<string, unknown>): number {
  return (shift.endTime as Timestamp | undefined)?.toMillis?.() ?? 0;
}

function createdMs(shift: Record<string, unknown>): number {
  return (
    (shift.createdAt as Timestamp | undefined)?.toMillis?.()
    ?? (shift.coverageCreatedAt as Timestamp | undefined)?.toMillis?.()
    ?? startMs(shift)
  );
}

function adjustedStartMs(shift: Record<string, unknown>): number {
  return (
    (shift.adjustedStartTime as Timestamp | undefined)?.toMillis?.()
    ?? (shift.segmentFromTime && startMs(shift) ? startMs(shift) : 0)
    ?? startMs(shift)
  );
}

function lateEtaDeadlineMs(shift: Record<string, unknown>, plannedStartMs: number): number {
  const etaAt = (shift.lateArrivalEtaAt as Timestamp | undefined)?.toMillis?.() ?? 0;
  const cap = plannedStartMs + 60 * 60 * 1000;
  if (etaAt > 0) return Math.min(etaAt, cap);
  if (shift.lateArrivalConfirmed === true || shift.lateArrivalAt) return cap;
  return plannedStartMs + 5 * 60 * 1000;
}

/**
 * Ventanas servidor (espejo portal-core): normal T−15…T+5; tarde con aviso hasta min(eta, T+60);
 * OPERATIONS_COVERAGE: inicio−15 … max(created, inicio)+60; ADV: ventana adelanto o turno propio.
 */
export function evaluateServerCheckInWindow(
  shift: Record<string, unknown>,
  nowMs: number,
  opts?: { source?: string; ownShiftWindowMs?: number },
): CheckInWindowResult {
  if (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT') {
    return { allowed: false, rejectCode: 'ABSENT' };
  }
  if (isOpsCoverageHoursOnSourceDoc(shift)) {
    return { allowed: false, rejectCode: 'TRACE_REGISTRATION' };
  }

  const source = String(opts?.source || '').toUpperCase();
  if (source === 'OPERATIONS' || source === 'VIGI' || source === 'DEMO' || source === 'MANUAL_RADIO' || source === 'MANUAL_PHONE') {
    return { allowed: true, usePlannedStart: false, lateMinutes: 0 };
  }

  const origin = String(shift.origin || '').toUpperCase();
  const ct = String(shift.coverageType || '').toUpperCase();
  const plannedStart = startMs(shift);
  const end = endMs(shift);
  if (end > 0 && nowMs > end) return { allowed: false, rejectCode: 'SHIFT_ENDED' };
  if (!plannedStart) return { allowed: false, rejectCode: 'TOO_EARLY' };

  let windowStart = plannedStart - 15 * 60 * 1000;
  let windowEnd = plannedStart + 5 * 60 * 1000;

  if (shift.lateArrivalAt || shift.lateArrivalConfirmed) {
    windowEnd = lateEtaDeadlineMs(shift, plannedStart);
  }

  if (origin === 'OPERATIONS_COVERAGE' && ct !== 'EXTEND' && ct !== 'ADVANCE') {
    const gapStart = plannedStart;
    windowStart = gapStart - 15 * 60 * 1000;
    windowEnd = Math.max(createdMs(shift), gapStart) + 60 * 60 * 1000;
  }

  if (ct === 'ADVANCE' || shift.coverageType === 'ADVANCE') {
    const advStart = adjustedStartMs(shift) || plannedStart;
    const advEnd = advStart + 60 * 60 * 1000;
    const ownStart = opts?.ownShiftWindowMs ?? plannedStart;
    const ownWinStart = ownStart - 15 * 60 * 1000;
    const ownWinEnd = ownStart + 5 * 60 * 1000;
    const inAdv = nowMs >= advStart - 15 * 60 * 1000 && nowMs <= advEnd;
    const inOwn = nowMs >= ownWinStart && nowMs <= ownWinEnd;
    if (!inAdv && !inOwn) {
      return { allowed: false, rejectCode: nowMs < advStart - 15 * 60 * 1000 ? 'TOO_EARLY' : 'TOO_LATE' };
    }
  } else {
    if (nowMs < windowStart) return { allowed: false, rejectCode: 'TOO_EARLY' };
    if (nowMs > windowEnd) return { allowed: false, rejectCode: 'TOO_LATE' };
  }

  const onTimeEnd = plannedStart + 5 * 60 * 1000;
  if (nowMs <= onTimeEnd) {
    return { allowed: true, usePlannedStart: true, lateMinutes: 0 };
  }
  const lateMinutes = Math.max(0, Math.round((nowMs - plannedStart) / 60000));
  return { allowed: true, usePlannedStart: false, lateMinutes };
}
