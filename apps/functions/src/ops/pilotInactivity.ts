/**
 * Piloto sin actividad: la sesión del piloto no registró heartbeat ni acción
 * en los últimos 5 minutos. Espejo en apps/web2/src/lib/operaciones/pilotInactivity.ts.
 */
export const PILOT_INACTIVE_MS = 5 * 60 * 1000;

export interface PilotActivitySession {
  startTime: Date;
  lastActivityAt?: Date | null;
}

/** Último instante en que el piloto dio señales de vida (heartbeat, acción o inicio). */
export function pilotLastActivityMs(session: PilotActivitySession): number {
  const beat = session.lastActivityAt instanceof Date ? session.lastActivityAt.getTime() : 0;
  const start = session.startTime instanceof Date ? session.startTime.getTime() : 0;
  return Math.max(beat, start);
}

export function pilotInactiveMinutes(session: PilotActivitySession, nowMs: number = Date.now()): number {
  const last = pilotLastActivityMs(session);
  if (!last) return 0;
  return Math.max(0, Math.floor((nowMs - last) / 60000));
}

export function isPilotInactive(session: PilotActivitySession | null | undefined, nowMs: number = Date.now()): boolean {
  if (!session) return false;
  const last = pilotLastActivityMs(session);
  if (!last) return false;
  return nowMs - last >= PILOT_INACTIVE_MS;
}
