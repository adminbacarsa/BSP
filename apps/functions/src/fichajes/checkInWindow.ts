import { Timestamp } from 'firebase-admin/firestore';
import { isOpsCoverageHoursOnSourceDoc } from '../coverage/coverageTraceShift';

export type CheckInWindowResult = {
  allowed: boolean;
  rejectCode?: 'ABSENT' | 'TRACE_REGISTRATION' | 'TOO_EARLY' | 'TOO_LATE' | 'SHIFT_ENDED';
  usePlannedStart?: boolean;
  /** Fichada en ventana de adelanto (isEarlyStart) → realStartTime = adjustedStartTime si a tiempo */
  useAdjustedStart?: boolean;
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
  const adj = (shift.adjustedStartTime as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (adj > 0) return adj;
  return startMs(shift);
}

/** Fin ventana propia: T+5 o min(eta, T+60) si hay eta; sin eta pero con aviso → T+30. */
function lateEtaDeadlineMs(shift: Record<string, unknown>, plannedStartMs: number): number {
  const etaAt = (shift.lateArrivalEtaAt as Timestamp | undefined)?.toMillis?.() ?? 0;
  const cap60 = plannedStartMs + 60 * 60 * 1000;
  if (etaAt > 0) return Math.min(etaAt, cap60);
  if (shift.lateArrivalConfirmed === true || shift.lateArrivalAt) {
    return plannedStartMs + 30 * 60 * 1000;
  }
  return plannedStartMs + 5 * 60 * 1000;
}

function finishAllowed(
  anchorStartMs: number,
  nowMs: number,
  useAdjustedStart: boolean,
): CheckInWindowResult {
  const onTimeEnd = anchorStartMs + 5 * 60 * 1000;
  if (nowMs <= onTimeEnd) {
    return {
      allowed: true,
      usePlannedStart: true,
      useAdjustedStart,
      lateMinutes: 0,
    };
  }
  const lateMinutes = Math.max(0, Math.round((nowMs - anchorStartMs) / 60000));
  return {
    allowed: true,
    usePlannedStart: false,
    useAdjustedStart,
    lateMinutes,
  };
}

/**
 * Ventanas servidor (espejo portal-core): normal T−15…T+5; tarde con aviso;
 * OPERATIONS_COVERAGE convocado; isEarlyStart = adelanto OR turno propio.
 */
export function evaluateServerCheckInWindow(
  shift: Record<string, unknown>,
  nowMs: number,
  opts?: { source?: string },
): CheckInWindowResult {
  if (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT') {
    return { allowed: false, rejectCode: 'ABSENT' };
  }
  if (isOpsCoverageHoursOnSourceDoc(shift)) {
    return { allowed: false, rejectCode: 'TRACE_REGISTRATION' };
  }

  const source = String(opts?.source || '').toUpperCase();
  if (
    source === 'OPERATIONS'
    || source === 'VIGI'
    || source === 'DEMO'
    || source === 'MANUAL_RADIO'
    || source === 'MANUAL_PHONE'
  ) {
    return { allowed: true, usePlannedStart: false, lateMinutes: 0 };
  }

  const origin = String(shift.origin || '').toUpperCase();
  const ct = String(shift.coverageType || '').toUpperCase();
  const plannedStart = startMs(shift);
  const end = endMs(shift);
  if (end > 0 && nowMs > end) return { allowed: false, rejectCode: 'SHIFT_ENDED' };
  if (!plannedStart) return { allowed: false, rejectCode: 'TOO_EARLY' };

  if (origin === 'OPERATIONS_COVERAGE' && ct !== 'EXTEND' && ct !== 'ADVANCE') {
    const gapStart = plannedStart;
    const windowStart = gapStart - 15 * 60 * 1000;
    const windowEnd = Math.max(createdMs(shift), gapStart) + 60 * 60 * 1000;
    if (nowMs < windowStart) return { allowed: false, rejectCode: 'TOO_EARLY' };
    if (nowMs > windowEnd) return { allowed: false, rejectCode: 'TOO_LATE' };
    return finishAllowed(gapStart, nowMs, false);
  }

  if (shift.isEarlyStart === true) {
    const advStart = adjustedStartMs(shift);
    const advWinStart = advStart - 15 * 60 * 1000;
    const advWinEnd = advStart + 60 * 60 * 1000;
    const ownWinStart = plannedStart - 15 * 60 * 1000;
    const ownWinEnd = lateEtaDeadlineMs(shift, plannedStart);
    const inAdv = nowMs >= advWinStart && nowMs <= advWinEnd;
    const inOwn = nowMs >= ownWinStart && nowMs <= ownWinEnd;
    if (!inAdv && !inOwn) {
      const tooEarly = nowMs < advWinStart && nowMs < ownWinStart;
      return { allowed: false, rejectCode: tooEarly ? 'TOO_EARLY' : 'TOO_LATE' };
    }
    if (inAdv) {
      return finishAllowed(advStart, nowMs, true);
    }
    return finishAllowed(plannedStart, nowMs, false);
  }

  const windowStart = plannedStart - 15 * 60 * 1000;
  const windowEnd = lateEtaDeadlineMs(shift, plannedStart);
  if (nowMs < windowStart) return { allowed: false, rejectCode: 'TOO_EARLY' };
  if (nowMs > windowEnd) return { allowed: false, rejectCode: 'TOO_LATE' };
  return finishAllowed(plannedStart, nowMs, false);
}
