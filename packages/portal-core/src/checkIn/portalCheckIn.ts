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
  isExtended?: boolean;
  adjustedStartTime?: unknown;
  createdAt?: unknown;
  coverageHoursOnSource?: boolean;
};

/** Cobertura urgente creada desde Operaciones (hueco por ausencia). */
export function isOperationsCoverageShift(shift: Pick<Shift, 'origin'> | null | undefined): boolean {
  return String(shift?.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';
}

/**
 * ops_cov EXTEND/ADVANCE de registro: las horas viven en el turno propio
 * (isExtended / isEarlyStart). No se ficha ni es hero.
 */
export function isCoverageHoursOnSourceShift(
  shift: (Pick<Shift, 'origin'> & { coverageHoursOnSource?: boolean }) | null | undefined,
): boolean {
  if (!shift || shift.coverageHoursOnSource !== true) return false;
  return isOperationsCoverageShift(shift);
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

/** Ventana propia del turno (T−15…T+5 o extendida por llegada tarde). */
function ownShiftWindowTiming(
  s: ShiftTimingFields,
  start: Date,
  now: Date,
  options?: CheckInTimingOptions,
): CheckInTiming {
  const diffMinutes = minutesBetween(start, now);
  const eta = readEtaMinutes(s, options?.etaMinutesOverride);
  const lateFlag = hasLateArrivalFlag(s);

  if (lateFlag) {
    const extensionMin = eta != null ? Math.min(eta, 60) : 30;
    const open = new Date(start.getTime() - 15 * 60_000);
    const close = new Date(start.getTime() + extensionMin * 60_000);
    const canCheckIn = inWindow(now, open, close);
    return {
      diffMinutes,
      canCheckIn,
      canNotifyLate: false,
      lateWindow: false,
      tooEarly: now.getTime() < open.getTime(),
      checkInDeadline: close,
    };
  }

  const canCheckIn = diffMinutes <= 15 && diffMinutes >= -5;
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
 * Ventanas CC (portal):
 * - Normal: T−15…T+5
 * - Aviso tarde (lateArrivalAt / confirmed): hasta min(inicio+eta, T+60); sin eta → T+30
 * - OPERATIONS_COVERAGE (no registro): inicio−15 … max(createdAt, inicio)+60
 * - ADV (isEarlyStart): ventana adelanto OR ventana propia (normal/tarde)
 * - coverageHoursOnSource: no fichable (registro EXT/ADV)
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

  // Registro EXT/ADV: no se ficha (el presente va al turno propio).
  if (isCoverageHoursOnSourceShift(s)) {
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

  // ADV / adelanto: ventana del adelanto O la del turno propio (normal / llegada tarde).
  // AA solo si no llega a su horario propio — el adelanto es opcional.
  if (isEarlyStartShift(s) && start) {
    const adj = resolveAdjustedStartTime(s, start) ?? start;
    const earlyOpen = new Date(adj.getTime() - 15 * 60_000);
    const earlyClose = new Date(adj.getTime() + 60 * 60_000);
    const inEarly = inWindow(now, earlyOpen, earlyClose);
    const own = ownShiftWindowTiming(s, start, now, options);
    const canCheckIn = inEarly || own.canCheckIn;
    const deadlines: number[] = [];
    if (inEarly) deadlines.push(earlyClose.getTime());
    if (own.canCheckIn && own.checkInDeadline) deadlines.push(own.checkInDeadline.getTime());
    const earliestOpen = Math.min(earlyOpen.getTime(), start.getTime() - 15 * 60_000);
    return {
      diffMinutes: inEarly ? minutesBetween(adj, now) : own.diffMinutes,
      canCheckIn,
      canNotifyLate: own.canNotifyLate,
      lateWindow: own.lateWindow,
      tooEarly: !canCheckIn && now.getTime() < earliestOpen,
      checkInDeadline: deadlines.length > 0 ? new Date(Math.max(...deadlines)) : own.checkInDeadline ?? null,
    };
  }

  // Cobertura ops (urgencia real): inicio−15 … max(createdAt, inicio)+60
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

  return ownShiftWindowTiming(s, start, now, options);
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
