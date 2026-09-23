import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import { toDate } from '../utils/dates';
import { haversineKm, isWithinCheckInRadius } from '../geo/haversine';
import { isAbsentLikeShift } from '../shifts/isAbsentLikeShift';

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
};

export type CheckInTimingOptions = {
  /** Lab/emulador con allowRemoteCheckIn: ventana amplia para no depender del minuto exacto del seed */
  relaxWindow?: boolean;
  /** ETA local optimista si el backend aún no persistió etaMinutes. */
  etaMinutesOverride?: number | null;
};

/** Campos extra de turno usados en ventanas CC (no todos están tipados en portal-types). */
type ShiftTimingFields = Shift & {
  isRetention?: boolean;
  lateArrivalConfirmed?: boolean;
  etaMinutes?: number;
  lateArrivalEtaMinutes?: number;
  isEarlyStart?: boolean;
  isAdvanced?: boolean;
  adjustedStartTime?: unknown;
  createdAt?: unknown;
};

/** Cobertura urgente creada desde Operaciones (hueco por ausencia). */
export function isOperationsCoverageShift(shift: Pick<Shift, 'origin'> | null | undefined): boolean {
  return String(shift?.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';
}

function readEtaMinutes(shift: ShiftTimingFields, override?: number | null): number | null {
  if (override != null && Number.isFinite(override) && override > 0) return Math.round(override);
  const raw = shift.etaMinutes ?? shift.lateArrivalEtaMinutes;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function hasLateArrivalFlag(shift: ShiftTimingFields): boolean {
  return !!(shift.lateArrivalAt || shift.lateArrivalConfirmed);
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

function isEarlyStartShift(shift: ShiftTimingFields): boolean {
  if (shift.isEarlyStart === true || shift.isAdvanced === true) return true;
  const origin = String(shift.origin || '').toUpperCase();
  return origin === 'EARLY_START' || origin === 'ADVANCE';
}

function minutesBetween(from: Date, to: Date): number {
  return Math.round((from.getTime() - to.getTime()) / 60000);
}

function inWindow(now: Date, open: Date, close: Date): boolean {
  const t = now.getTime();
  return t >= open.getTime() && t <= close.getTime();
}

/**
 * Ventanas CC (portal):
 * - Normal: T−15…T+5
 * - Aviso tarde (lateArrivalAt / confirmed): hasta min(inicio+eta, T+60); sin eta → T+30
 * - OPERATIONS_COVERAGE: inicio−15 … max(createdAt, inicio)+60
 * - ADV (isEarlyStart): adjustedStart−15 … adjustedStart+60
 * - Ausente: no ficha
 */
export function getCheckInTiming(
  shift: Shift,
  now = new Date(),
  options?: CheckInTimingOptions,
): CheckInTiming {
  const s = shift as ShiftTimingFields;
  const start = toDate(s.startTime);
  const diffMinutes = start ? minutesBetween(start, now) : null;

  const empty: CheckInTiming = {
    diffMinutes,
    canCheckIn: false,
    canNotifyLate: false,
    lateWindow: false,
    tooEarly: false,
    checkInDeadline: null,
  };

  if (isAbsentLikeShift(s as unknown as Record<string, unknown>)) {
    return empty;
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
    return {
      diffMinutes,
      canCheckIn,
      canNotifyLate,
      lateWindow: canNotifyLate,
      tooEarly,
      checkInDeadline: null,
    };
  }

  // ADV / adelanto: ventana centrada en adjustedStartTime
  if (isEarlyStartShift(s) && start) {
    const adj = resolveAdjustedStartTime(s, start) ?? start;
    const open = new Date(adj.getTime() - 15 * 60_000);
    const close = new Date(adj.getTime() + 60 * 60_000);
    const canCheckIn = inWindow(now, open, close);
    const tooEarly = now.getTime() < open.getTime();
    return {
      diffMinutes: minutesBetween(adj, now),
      canCheckIn,
      canNotifyLate: false,
      lateWindow: false,
      tooEarly,
      checkInDeadline: close,
    };
  }

  // Cobertura ops: inicio−15 … max(createdAt, inicio)+60
  if (isOperationsCoverageShift(s) && start) {
    const created = toDate(s.createdAt as never);
    const anchor = created && created.getTime() > start.getTime() ? created : start;
    const open = new Date(start.getTime() - 15 * 60_000);
    const close = new Date(anchor.getTime() + 60 * 60_000);
    const canCheckIn = inWindow(now, open, close);
    const tooEarly = now.getTime() < open.getTime();
    return {
      diffMinutes,
      canCheckIn,
      canNotifyLate: false,
      lateWindow: false,
      tooEarly,
      checkInDeadline: close,
    };
  }

  if (!start || diffMinutes === null) {
    return empty;
  }

  const eta = readEtaMinutes(s, options?.etaMinutesOverride);
  const lateFlag = hasLateArrivalFlag(s);

  // Con aviso / confirmación de llegada tarde: ventana extendida
  if (lateFlag) {
    const extensionMin = eta != null ? Math.min(eta, 60) : 30;
    const open = new Date(start.getTime() - 15 * 60_000);
    const close = new Date(start.getTime() + extensionMin * 60_000);
    const canCheckIn = inWindow(now, open, close);
    const tooEarly = now.getTime() < open.getTime();
    return {
      diffMinutes,
      canCheckIn,
      canNotifyLate: false,
      lateWindow: false,
      tooEarly,
      checkInDeadline: close,
    };
  }

  // Normal: T−15…T+5
  const canCheckIn = diffMinutes <= 15 && diffMinutes >= -5;
  // Aviso previo: T−60…T+5
  const canNotifyLate = diffMinutes <= 60 && diffMinutes >= -5;
  const tooEarly = diffMinutes > 15;

  return {
    diffMinutes,
    canCheckIn,
    canNotifyLate,
    lateWindow: canNotifyLate,
    tooEarly: tooEarly && !canCheckIn,
    checkInDeadline: canCheckIn ? new Date(start.getTime() + 5 * 60_000) : null,
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
  // Sin geolocalización configurada → se permite fichar (regla CC).
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
