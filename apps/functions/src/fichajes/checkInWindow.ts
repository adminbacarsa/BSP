import { Timestamp } from 'firebase-admin/firestore';
import { isReversibleLateAbsence, lateAbsenceDeadlineMs } from '../attendance/lateAbsenceWindow';
import { isOpsCoverageHoursOnSourceDoc } from '../coverage/coverageTraceShift';
import { isAltaArcaConfirmada } from '../arca/altaArcaGate';

export type CheckInWindowResult = {
  allowed: boolean;
  rejectCode?: 'ABSENT' | 'TRACE_REGISTRATION' | 'TOO_EARLY' | 'TOO_LATE' | 'SHIFT_ENDED' | 'EXT_NO_CHECKIN' | 'ALTA_ARCA_PENDIENTE';
  usePlannedStart?: boolean;
  /** Fichada en ventana de adelanto (isEarlyStart) → realStartTime = adjustedStartTime si a tiempo */
  useAdjustedStart?: boolean;
  lateMinutes?: number;
  /** Entre T+5 y T+30 sin aviso previo: la fichada es llegada tarde (novedad LLEGADA_TARDE). */
  lateNoNotice?: boolean;
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

/** Aceptación de la convocatoria. Sin `acceptedAt`, cae a createdAt del ops_cov. */
export function convocadoPunchAnchorMs(shift: Record<string, unknown>): number {
  const acc = (shift.acceptedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (acc > 0) return acc;
  return createdMs(shift);
}

/**
 * Hueco futuro (inicio > aceptación + viaje): la fichada abre a T−15.
 * Hueco ya empezado, o sin ETA: desde la aceptación.
 */
export function convocadoPunchOpenMs(shift: Record<string, unknown>): number {
  const gap = startMs(shift);
  const accepted = convocadoPunchAnchorMs(shift);
  if (gap > 0 && accepted > 0 && gap > accepted + 15 * 60_000) {
    return gap - 15 * 60 * 1000;
  }
  const eta = Number(shift.etaMinutes);
  if (gap > 0 && accepted > 0 && Number.isFinite(eta) && eta > 0 && gap > accepted + eta * 60_000) {
    return gap - 15 * 60 * 1000;
  }
  return accepted;
}

/** Tope de fichada del convocado: el fin del hueco. Sin fin, no hay tope corto. */
export function convocadoPunchCapMs(shift: Record<string, unknown>): number {
  const end = endMs(shift);
  return end > 0 ? end : convocadoPunchAnchorMs(shift) + 12 * 60 * 60 * 1000;
}

function adjustedStartMs(shift: Record<string, unknown>): number {
  const adj = (shift.adjustedStartTime as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (adj > 0) return adj;
  return startMs(shift);
}

function hasPriorLateNotice(shift: Record<string, unknown>): boolean {
  const etaAt = (shift.lateArrivalEtaAt as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (etaAt > 0) return true;
  return shift.lateArrivalConfirmed === true || !!shift.lateArrivalAt;
}

/** Fin de fichada en hora: max(T+30, min(ETA, T+60)). Sin ETA → T+30. */
function lateEtaDeadlineMs(shift: Record<string, unknown>, plannedStartMs: number): number {
  const etaAt = (shift.lateArrivalEtaAt as Timestamp | undefined)?.toMillis?.() ?? 0;
  return lateAbsenceDeadlineMs(plannedStartMs, etaAt);
}

function finishAllowed(
  anchorStartMs: number,
  nowMs: number,
  useAdjustedStart: boolean,
  lateNoNoticeEligible = false,
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
    ...(lateNoNoticeEligible && lateMinutes > 0 ? { lateNoNotice: true } : {}),
  };
}

/**
 * Ventanas servidor (espejo portal-core): normal T−15…T+30 (T+5…T+30 sin aviso = llegada tarde);
 * con aviso hasta max(T+30, min(ETA, T+60)); AA provisoria fichable hasta T+60;
 * convocado (no EXT): hueco ya empezado desde la aceptación; hueco futuro desde T−15; hasta el fin, sin tarde;
 * isEarlyStart = adelanto OR turno propio.
 */
/** Día calendario en Argentina (YYYY-MM-DD). */
export function arCalendarDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function evaluateServerCheckInWindow(
  shift: Record<string, unknown>,
  nowMs: number,
  opts?: { source?: string; fichadaRemota?: boolean },
): CheckInWindowResult {
  // Bloqueo legal, antes que cualquier ventana ni bypass del CC: sin alta AT confirmada no se ficha.
  if (!isAltaArcaConfirmada(shift)) {
    return { allowed: false, rejectCode: 'ALTA_ARCA_PENDIENTE' };
  }
  const plannedStartEarly = startMs(shift);
  if (
    (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT')
    && isReversibleLateAbsence(shift, nowMs)
    && plannedStartEarly > 0
  ) {
    const endEarly = endMs(shift);
    if (endEarly > 0 && nowMs > endEarly) return { allowed: false, rejectCode: 'SHIFT_ENDED' };
    return finishAllowed(plannedStartEarly, nowMs, false, !hasPriorLateNotice(shift));
  }
  if (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT') {
    return { allowed: false, rejectCode: 'ABSENT' };
  }
  const originEarly = String(shift.origin || '').toUpperCase();
  const ctEarly = String(shift.coverageType || '').toUpperCase();
  if (originEarly === 'OPERATIONS_COVERAGE' && ctEarly === 'EXTEND') {
    return { allowed: false, rejectCode: 'EXT_NO_CHECKIN' };
  }
  if (isOpsCoverageHoursOnSourceDoc(shift) && ctEarly !== 'ADVANCE') {
    return { allowed: false, rejectCode: 'TRACE_REGISTRATION' };
  }

  const plannedForReview = startMs(shift);
  if (opts?.fichadaRemota === true && plannedForReview > 0) {
    const sameDay = arCalendarDay(nowMs) === arCalendarDay(plannedForReview);
    if (!sameDay) {
      return {
        allowed: false,
        rejectCode: nowMs < plannedForReview ? 'TOO_EARLY' : 'SHIFT_ENDED',
      };
    }
    return { allowed: true, usePlannedStart: true, lateMinutes: 0 };
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

  if (origin === 'OPERATIONS_COVERAGE' && ct === 'EXTEND') {
    return { allowed: false, rejectCode: 'EXT_NO_CHECKIN' };
  }
  if (origin === 'OPERATIONS_COVERAGE' && shift.refEscAsignacionDirecta !== true) {
    const anchor = convocadoPunchOpenMs(shift);
    const cap = convocadoPunchCapMs(shift);
    if (anchor > 0 && nowMs < anchor) return { allowed: false, rejectCode: 'TOO_EARLY' };
    if (cap > 0 && nowMs > cap) return { allowed: false, rejectCode: 'SHIFT_ENDED' };
    return { allowed: true, usePlannedStart: false, lateMinutes: 0 };
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
    return finishAllowed(plannedStart, nowMs, false, !hasPriorLateNotice(shift));
  }

  const windowStart = plannedStart - 15 * 60 * 1000;
  const windowEnd = lateEtaDeadlineMs(shift, plannedStart);
  if (nowMs < windowStart) return { allowed: false, rejectCode: 'TOO_EARLY' };
  if (nowMs > windowEnd) return { allowed: false, rejectCode: 'TOO_LATE' };
  return finishAllowed(plannedStart, nowMs, false, !hasPriorLateNotice(shift));
}
