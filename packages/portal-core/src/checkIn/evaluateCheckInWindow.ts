/**
 * Espejo exacto de `apps/functions/src/fichajes/checkInWindow.ts` → evaluateServerCheckInWindow.
 * Sin firebase-admin: acepta Timestamp-like / Date / number / ISO string.
 * NO modificar functions desde App — si el server está mal, anotar para Plataforma.
 */

export type CheckInWindowRejectCode =
  | 'ABSENT'
  | 'TRACE_REGISTRATION'
  | 'TOO_EARLY'
  | 'TOO_LATE'
  | 'SHIFT_ENDED';

export type CheckInWindowResult = {
  allowed: boolean;
  rejectCode?: CheckInWindowRejectCode;
  usePlannedStart?: boolean;
  useAdjustedStart?: boolean;
  lateMinutes?: number;
  /** Entre T+5 y T+30 sin aviso previo: la fichada es llegada tarde (novedad LLEGADA_TARDE). */
  lateNoNotice?: boolean;
};

/** ops_cov EXT/ADV de registro — mismo criterio que isOpsCoverageHoursOnSourceDoc (functions). */
export function isCoverageHoursOnSourceDoc(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  if (data.coverageHoursOnSource === true) return true;
  const ct = String(data.coverageType || '').toUpperCase();
  if (
    String(data.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE' &&
    (ct === 'EXTEND' || ct === 'ADVANCE')
  ) {
    return true;
  }
  return false;
}

/**
 * Cobertura aceptada (convocado): no es el registro EXT/ADV.
 * La fichada va desde que aceptó hasta el fin del hueco, sin ventana T−15/T+30.
 */
export function isConvocadoCoverageShift(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  if (String(data.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return false;
  return !isCoverageHoursOnSourceDoc(data);
}

/** Convierte Timestamp Firestore / Date / ms / ISO a epoch ms (0 si inválido). */
export function timestampLikeToMillis(val: unknown): number {
  if (val == null || val === '') return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val instanceof Date) {
    const t = val.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof val === 'object') {
    const o = val as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof o.toMillis === 'function') {
      const t = o.toMillis();
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof o.toDate === 'function') {
      const d = o.toDate();
      const t = d?.getTime?.() ?? NaN;
      return Number.isNaN(t) ? 0 : t;
    }
    const seconds = o.seconds ?? o._seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000;
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    const t = d.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

function startMs(shift: Record<string, unknown>): number {
  return timestampLikeToMillis(shift.startTime);
}

function endMs(shift: Record<string, unknown>): number {
  return timestampLikeToMillis(shift.endTime);
}

function createdMs(shift: Record<string, unknown>): number {
  const c = timestampLikeToMillis(shift.createdAt);
  if (c > 0) return c;
  const cc = timestampLikeToMillis(shift.coverageCreatedAt);
  if (cc > 0) return cc;
  return startMs(shift);
}

function adjustedStartMs(shift: Record<string, unknown>): number {
  const adj = timestampLikeToMillis(shift.adjustedStartTime);
  if (adj > 0) return adj;
  return startMs(shift);
}

function hasPriorLateNotice(shift: Record<string, unknown>): boolean {
  const etaAt = timestampLikeToMillis(shift.lateArrivalEtaAt);
  if (etaAt > 0) return true;
  return shift.lateArrivalConfirmed === true || !!shift.lateArrivalAt;
}

const LATE_FLOOR_MS = 30 * 60 * 1000;
const LATE_CAP_MS = 60 * 60 * 1000;

/** Espejo de functions `lateAbsenceDeadlineMs`: max(T+30, min(ETA, T+60)). */
function lateEtaDeadlineMs(shift: Record<string, unknown>, plannedStartMs: number): number {
  const etaAt = timestampLikeToMillis(shift.lateArrivalEtaAt);
  if (plannedStartMs <= 0) return 0;
  const floor = plannedStartMs + LATE_FLOOR_MS;
  const cap = plannedStartMs + LATE_CAP_MS;
  if (etaAt > 0) return Math.max(floor, Math.min(etaAt, cap));
  return floor;
}

function isProvisionalLatePunch(shift: Record<string, unknown>, nowMs: number): boolean {
  const absent = shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
  if (!absent) return false;
  const by = String(shift.absenceDetectedBy || '').toUpperCase();
  if (by !== 'AUTO_T30' && by !== 'ETA_VENCIDA') return false;
  const start = startMs(shift);
  if (start <= 0) return false;
  return nowMs < start + LATE_CAP_MS;
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
 * Ventanas de fichada — paridad con evaluateServerCheckInWindow.
 */
export function evaluateCheckInWindow(
  shift: Record<string, unknown>,
  nowMs: number,
  opts?: { source?: string },
): CheckInWindowResult {
  if (isProvisionalLatePunch(shift, nowMs)) {
    const planned = startMs(shift);
    const endEarly = endMs(shift);
    if (endEarly > 0 && nowMs > endEarly) return { allowed: false, rejectCode: 'SHIFT_ENDED' };
    return finishAllowed(planned, nowMs, false, !hasPriorLateNotice(shift));
  }
  if (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT') {
    return { allowed: false, rejectCode: 'ABSENT' };
  }
  if (isCoverageHoursOnSourceDoc(shift)) {
    return { allowed: false, rejectCode: 'TRACE_REGISTRATION' };
  }

  const source = String(opts?.source || '').toUpperCase();
  if (
    source === 'OPERATIONS' ||
    source === 'VIGI' ||
    source === 'DEMO' ||
    source === 'MANUAL_RADIO' ||
    source === 'MANUAL_PHONE'
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
    return finishAllowed(plannedStart, nowMs, false, !hasPriorLateNotice(shift));
  }

  const windowStart = plannedStart - 15 * 60 * 1000;
  const windowEnd = lateEtaDeadlineMs(shift, plannedStart);
  if (nowMs < windowStart) return { allowed: false, rejectCode: 'TOO_EARLY' };
  if (nowMs > windowEnd) return { allowed: false, rejectCode: 'TOO_LATE' };
  return finishAllowed(plannedStart, nowMs, false, !hasPriorLateNotice(shift));
}

/** Botón y texto del tramo T+5…T+30 sin aviso (portal). */
export function lateNoNoticeCheckInCopy(lateMinutes: number): {
  title: string;
  subtitle: string;
  actionLabel: string;
} {
  return {
    title: 'Llegada tarde',
    subtitle: `Llegás ${lateMinutes} min tarde; queda registrado.`,
    actionLabel: 'Llegada tarde',
  };
}

/** Mensajes UX para rechazo de ventana (portal guardia). */
export function checkInRejectMessage(code: CheckInWindowRejectCode | undefined): string {
  switch (code) {
    case 'TOO_EARLY':
      return 'Demasiado temprano para fichar. Disponible desde 15 min antes del inicio.';
    case 'TOO_LATE':
      return 'Fuera de la ventana de fichada. Contactá a operaciones si hace falta.';
    case 'SHIFT_ENDED':
      return 'El turno ya terminó; no se puede fichar.';
    case 'TRACE_REGISTRATION':
      return 'Es un registro de extensión/adelanto: no se ficha este turno (ficha el propio).';
    case 'ABSENT':
      return 'Este turno figura como ausente; no se puede fichar.';
    default:
      return 'No se puede fichar en este momento.';
  }
}
