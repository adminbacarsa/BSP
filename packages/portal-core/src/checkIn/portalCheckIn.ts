import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import { toDate } from '../utils/dates';
import { haversineKm, isWithinCheckInRadius } from '../geo/haversine';
import { isAbsentLikeShift } from '../shifts/isAbsentLikeShift';
import {
  checkInRejectMessage,
  evaluateCheckInWindow,
  isCoverageHoursOnSourceDoc,
  timestampLikeToMillis,
  type CheckInWindowRejectCode,
} from './evaluateCheckInWindow';

export {
  evaluateCheckInWindow,
  isCoverageHoursOnSourceDoc,
  checkInRejectMessage,
  timestampLikeToMillis,
} from './evaluateCheckInWindow';
export type { CheckInWindowResult, CheckInWindowRejectCode } from './evaluateCheckInWindow';

export const PENDING_CHECKINS_STORAGE_KEY = 'pending_checkins';

export type PortalCheckInCoords = { lat: number; lng: number };

export type PendingCheckInItem = {
  shiftId: string;
  coords: PortalCheckInCoords | null;
  createdAt: string;
  recordedAt: string;
  offline: boolean;
  idempotencyKey: string;
};

export type CheckInTiming = {
  diffMinutes: number | null;
  canCheckIn: boolean;
  /** Ventana T−60…T+5 para avisar llegada tarde (aviso previo). */
  canNotifyLate: boolean;
  /** Compat UI: mismo criterio que canNotifyLate (antes era post T+5). */
  lateWindow: boolean;
  tooEarly: boolean;
  /** Hora límite de fichada (si aplica ventana extendida). */
  checkInDeadline?: Date | null;
  /** Código de rechazo alineado al servidor (si !canCheckIn). */
  rejectCode?: CheckInWindowRejectCode;
  /** Mensaje claro para el guardia. */
  rejectMessage?: string;
  /** T+5…T+30 sin aviso previo: el botón es «Llegada tarde». */
  lateNoNotice?: boolean;
  lateMinutes?: number;
};

export type CheckInTimingOptions = {
  /** Lab/emulador con allowRemoteCheckIn: ventana amplia para no depender del minuto exacto del seed */
  relaxWindow?: boolean;
  /** ETA local optimista si el backend aún no persistió lateArrivalEtaAt. */
  etaMinutesOverride?: number | null;
};

/** Campos extra de turno usados en ventanas CC (no todos están tipados en portal-types). */
type ShiftTimingFields = Shift & {
  isRetention?: boolean;
  lateArrivalConfirmed?: boolean;
  etaMinutes?: number;
  lateArrivalEtaMinutes?: number;
  lateArrivalEtaAt?: unknown;
  isEarlyStart?: boolean;
  isAdvanced?: boolean;
  isExtended?: boolean;
  adjustedStartTime?: unknown;
  createdAt?: unknown;
  coverageCreatedAt?: unknown;
  coverageHoursOnSource?: boolean;
  coverageType?: string;
};

/** Cobertura urgente creada desde Operaciones (hueco por ausencia). */
export function isOperationsCoverageShift(shift: Pick<Shift, 'origin'> | null | undefined): boolean {
  return String(shift?.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';
}

/**
 * ops_cov EXTEND/ADVANCE de registro: paridad con isOpsCoverageHoursOnSourceDoc (functions).
 */
export function isCoverageHoursOnSourceShift(
  shift:
    | (Pick<Shift, 'origin'> & {
        coverageHoursOnSource?: boolean;
        coverageType?: string;
      })
    | null
    | undefined,
): boolean {
  if (!shift) return false;
  return isCoverageHoursOnSourceDoc(shift as Record<string, unknown>);
}

/** Ajusta HH:MM o Timestamp a Date del día del turno (zona AR). */
export function resolveAdjustedStartTime(
  shift: ShiftTimingFields,
  fallbackStart: Date | null,
): Date | null {
  const raw = shift.adjustedStartTime;
  if (raw == null || raw === '') return fallbackStart;
  if (typeof raw === 'string' && /^\d{1,2}:\d{2}$/.test(raw.trim())) {
    const [hh, mm] = raw.trim().split(':').map(Number);
    const base = fallbackStart ?? new Date();
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(base);
    const hhmm = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    return new Date(`${dayKey}T${hhmm}:00-03:00`);
  }
  return toDate(raw as never) ?? fallbackStart;
}

function minutesBetween(from: Date, to: Date): number {
  return Math.round((from.getTime() - to.getTime()) / 60000);
}

function shiftToRecord(
  s: ShiftTimingFields,
  options?: CheckInTimingOptions,
): Record<string, unknown> {
  const rec: Record<string, unknown> = { ...(s as unknown as Record<string, unknown>) };

  // Normaliza adjustedStartTime HH:MM → Date (dato inconsistente; el server espera Timestamp).
  const startDate = toDate(s.startTime);
  if (typeof s.adjustedStartTime === 'string' && /^\d{1,2}:\d{2}$/.test(s.adjustedStartTime.trim())) {
    const adj = resolveAdjustedStartTime(s, startDate);
    if (adj) rec.adjustedStartTime = adj;
  }

  // Override optimista de ETA en minutos → lateArrivalEtaAt sintético si aún no llegó del server.
  const override = options?.etaMinutesOverride;
  if (
    override != null &&
    Number.isFinite(override) &&
    override > 0 &&
    !timestampLikeToMillis(rec.lateArrivalEtaAt)
  ) {
    const start = timestampLikeToMillis(rec.startTime);
    if (start > 0) {
      rec.lateArrivalEtaAt = start + Math.min(60, Math.round(override)) * 60_000;
      rec.lateArrivalConfirmed = true;
    }
  }
  return rec;
}

function deadlineFromWindow(shift: Record<string, unknown>, nowMs: number): Date | null {
  const origin = String(shift.origin || '').toUpperCase();
  const ct = String(shift.coverageType || '').toUpperCase();
  const plannedStart = timestampLikeToMillis(shift.startTime);
  if (!plannedStart) return null;

  if (origin === 'OPERATIONS_COVERAGE' && ct !== 'EXTEND' && ct !== 'ADVANCE') {
    const created =
      timestampLikeToMillis(shift.createdAt) ||
      timestampLikeToMillis(shift.coverageCreatedAt) ||
      plannedStart;
    return new Date(Math.max(created, plannedStart) + 60 * 60 * 1000);
  }

  if (shift.isEarlyStart === true) {
    const adj = timestampLikeToMillis(shift.adjustedStartTime) || plannedStart;
    const advClose = adj + 60 * 60 * 1000;
    const etaAt = timestampLikeToMillis(shift.lateArrivalEtaAt);
    const cap60 = plannedStart + 60 * 60 * 1000;
    let ownClose = plannedStart + 30 * 60 * 1000;
    if (etaAt > 0) ownClose = Math.min(etaAt, cap60);
    if (nowMs >= adj - 15 * 60_000 && nowMs <= advClose) return new Date(advClose);
    return new Date(ownClose);
  }

  const etaAt = timestampLikeToMillis(shift.lateArrivalEtaAt);
  const cap60 = plannedStart + 60 * 60 * 1000;
  if (etaAt > 0) return new Date(Math.min(etaAt, cap60));
  return new Date(plannedStart + 30 * 60 * 1000);
}

/**
 * Ventanas CC (portal) — canCheckIn alineado a evaluateServerCheckInWindow.
 */
export function getCheckInTiming(
  shift: Shift,
  now = new Date(),
  options?: CheckInTimingOptions,
): CheckInTiming {
  const s = shift as ShiftTimingFields;
  const start = toDate(s.startTime);
  const diffMinutes = start ? minutesBetween(start, now) : null;
  const nowMs = now.getTime();

  const empty: CheckInTiming = {
    diffMinutes,
    canCheckIn: false,
    canNotifyLate: false,
    lateWindow: false,
    tooEarly: false,
    checkInDeadline: null,
  };

  if (isAbsentLikeShift(s as unknown as Record<string, unknown>)) {
    return {
      ...empty,
      rejectCode: 'ABSENT',
      rejectMessage: checkInRejectMessage('ABSENT'),
    };
  }

  if (isCoverageHoursOnSourceShift(s)) {
    return {
      ...empty,
      rejectCode: 'TRACE_REGISTRATION',
      rejectMessage: checkInRejectMessage('TRACE_REGISTRATION'),
    };
  }

  if (s.isFranco && !s.isFrancoTrabajado && !isOperationsCoverageShift(s)) {
    return empty;
  }

  const relax = options?.relaxWindow === true && !s.isFranco;
  if (relax && diffMinutes !== null && start) {
    const end = toDate(s.endTime);
    const shiftEnded = end ? end.getTime() <= now.getTime() : false;
    const canCheckIn = !shiftEnded && diffMinutes <= 240 && diffMinutes >= -240;
    const tooEarly = diffMinutes > 240;
    const canNotifyLate = !shiftEnded && diffMinutes <= 60 && diffMinutes >= -5;
    const rejectCode = shiftEnded
      ? ('SHIFT_ENDED' as const)
      : tooEarly
        ? ('TOO_EARLY' as const)
        : canCheckIn
          ? undefined
          : ('TOO_LATE' as const);
    return {
      diffMinutes,
      canCheckIn,
      canNotifyLate,
      lateWindow: canNotifyLate,
      tooEarly,
      checkInDeadline: null,
      rejectCode,
      rejectMessage: rejectCode ? checkInRejectMessage(rejectCode) : undefined,
    };
  }

  const rec = shiftToRecord(s, options);
  const windowEval = evaluateCheckInWindow(rec, nowMs);
  const canCheckIn = windowEval.allowed === true;
  const rejectCode = windowEval.rejectCode;
  const tooEarly = rejectCode === 'TOO_EARLY';

  // Aviso "llegué tarde" (UX portal): T−60…T+5 en turnos normales / early, no ops_cov puro.
  const origin = String(s.origin || '').toUpperCase();
  const ct = String(s.coverageType || '').toUpperCase();
  const isOpsCov =
    origin === 'OPERATIONS_COVERAGE' && ct !== 'EXTEND' && ct !== 'ADVANCE';
  let canNotifyLate = false;
  if (
    !isOpsCov &&
    start &&
    diffMinutes != null &&
    rejectCode !== 'SHIFT_ENDED' &&
    rejectCode !== 'ABSENT' &&
    rejectCode !== 'TRACE_REGISTRATION'
  ) {
    canNotifyLate = diffMinutes <= 60 && diffMinutes >= -5 && !canCheckIn;
    if (canCheckIn && !(s.lateArrivalAt || s.lateArrivalConfirmed)) {
      canNotifyLate = diffMinutes <= 60 && diffMinutes >= -5;
    }
  }

  return {
    diffMinutes,
    canCheckIn,
    canNotifyLate,
    lateWindow: canNotifyLate,
    tooEarly,
    checkInDeadline: canCheckIn ? deadlineFromWindow(rec, nowMs) : null,
    rejectCode,
    rejectMessage: rejectCode ? checkInRejectMessage(rejectCode) : undefined,
    lateNoNotice: windowEval.lateNoNotice === true,
    lateMinutes: windowEval.lateMinutes,
  };
}

/**
 * GPS: fuera del radio no se puede fichar, salvo objetivo sin coordenadas
 * o con allowRemoteCheckIn.
 */
export function validateCheckInDistance(
  objective: ObjectiveLocation | null,
  coords: { latitude: number; longitude: number } | null,
): { ok: true } | { ok: false; message: string } {
  if (!objective) {
    return { ok: false, message: 'Objetivo sin ubicación configurada' };
  }
  const remoteAllowed = objective.allowRemoteCheckIn === true;
  if (remoteAllowed) {
    return { ok: true };
  }
  const hasLat = objective.lat != null && Number(objective.lat) !== 0;
  const hasLng = objective.lng != null && Number(objective.lng) !== 0;
  if (!hasLat || !hasLng) {
    return { ok: true };
  }
  if (!coords) {
    return { ok: false, message: 'No se pudo obtener la ubicación' };
  }
  if (!isWithinCheckInRadius(coords.latitude, coords.longitude, objective.lat, objective.lng)) {
    const distM = Math.round(
      haversineKm(coords.latitude, coords.longitude, objective.lat, objective.lng) * 1000,
    );
    return { ok: false, message: `Estás a más de 80 m del objetivo (${distM} m)` };
  }
  return { ok: true };
}

export function buildCheckInPayload(
  shiftId: string,
  coords: { latitude: number; longitude: number } | null,
  offline: boolean,
): {
  shiftId: string;
  coords: PortalCheckInCoords | null;
  offline: boolean;
  recordedAt: string;
  idempotencyKey: string;
} {
  const recordedAt = new Date().toISOString();
  return {
    shiftId,
    coords: coords ? { lat: coords.latitude, lng: coords.longitude } : null,
    offline,
    recordedAt,
    idempotencyKey: `ci_${shiftId}_${recordedAt}`,
  };
}

export function parsePendingCheckins(raw: string | null): PendingCheckInItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingCheckInItem[]) : [];
  } catch {
    return [];
  }
}

export async function flushPendingCheckins(
  items: PendingCheckInItem[],
  invoke: (item: PendingCheckInItem) => Promise<void>,
): Promise<PendingCheckInItem[]> {
  const remaining: PendingCheckInItem[] = [];
  for (const item of items) {
    try {
      await invoke(item);
    } catch {
      remaining.push(item);
    }
  }
  return remaining;
}
