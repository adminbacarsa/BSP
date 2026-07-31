import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import { toDate } from '../utils/dates';
import { haversineKm, isWithinCheckInRadius } from '../geo/haversine';

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
  lateWindow: boolean;
  tooEarly: boolean;
};

export type CheckInTimingOptions = {
  /** Lab/emulador con allowRemoteCheckIn: ventana amplia para no depender del minuto exacto del seed */
  relaxWindow?: boolean;
};

export function getCheckInTiming(
  shift: Shift,
  now = new Date(),
  options?: CheckInTimingOptions,
): CheckInTiming {
  const start = toDate(shift.startTime);
  const diffMinutes = start ? Math.round((start.getTime() - now.getTime()) / 60000) : null;
  const relax = options?.relaxWindow === true && !shift.isFranco;

  if (relax && diffMinutes !== null) {
    const end = toDate(shift.endTime);
    const shiftEnded = end ? end.getTime() <= now.getTime() : false;
    const canCheckIn = !shiftEnded && diffMinutes <= 240 && diffMinutes >= -240;
    const tooEarly = diffMinutes > 240;
    const lateWindow = !shiftEnded && diffMinutes < -240 && diffMinutes >= -480;
    return { diffMinutes, canCheckIn, lateWindow, tooEarly };
  }

  const canCheckIn =
    diffMinutes !== null && diffMinutes <= 15 && diffMinutes >= -5 && !shift.isFranco;
  const lateWindow = diffMinutes !== null && diffMinutes < -5 && diffMinutes >= -120;
  const tooEarly = diffMinutes !== null && diffMinutes > 15;
  return { diffMinutes, canCheckIn, lateWindow, tooEarly };
}

export function validateCheckInDistance(
  objective: ObjectiveLocation | null,
  coords: { latitude: number; longitude: number } | null,
): { ok: true } | { ok: false; message: string } {
  const remoteAllowed = objective?.allowRemoteCheckIn === true;
  if (!objective || (!objective.lat && !objective.lng && !remoteAllowed)) {
    return { ok: false, message: 'Objetivo sin ubicación configurada' };
  }
  if (remoteAllowed) {
    return { ok: true };
  }
  if (!objective.lat || !objective.lng) {
    return { ok: false, message: 'Objetivo sin coordenadas GPS' };
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
