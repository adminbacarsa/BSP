/**
 * Guardas de la cascada de cobertura (auditoría CC 29/09/2026).
 *
 * 1. Una cascada por hueco: el trigger `onTurnoAbsenciaDetectada`, la callable
 *    `marcarAusenciaOperaciones` (`openLateAbsenceVacancy`) y `gestionarVacantes` pueden
 *    arrancar `iniciarCascadaCobertura` sobre el mismo titular en el mismo segundo. El chequeo
 *    "¿hay convocatoria PENDING?" es leer-y-escribir sin transacción, así que las dos pasan y
 *    quedan dos o tres convocatorias iguales (Obrador: HERRANTE ×3, RODRIGUEZ GIACOM ×2).
 *    El candado `cascadeLockAt` en el doc del titular se toma en transacción y vale
 *    `CASCADE_LOCK_MS`; después de eso manda el chequeo de convocatorias activas.
 *
 * 2. Un rechazo tardío no vuelve a avanzar: si la convocatoria ya está ESCALATED, el timeout
 *    ya avanzó al paso siguiente. Un REJECTED posterior (portal o Demo) es informativo; si
 *    avanzara otra vez, el paso FT se dispararía dos veces (BARRIOS CARRANZA 00:12 y 00:13).
 */
export const CASCADE_LOCK_MS = 90 * 1000;

export function cascadeLockHeld(lockAtMs: number, nowMs: number): boolean {
  if (!lockAtMs || !Number.isFinite(lockAtMs)) return false;
  const age = nowMs - lockAtMs;
  return age >= 0 && age < CASCADE_LOCK_MS;
}

export function shouldAdvanceOnReject(previousStatus: unknown): boolean {
  return String(previousStatus || '').toUpperCase() !== 'ESCALATED';
}

export function toMillisLoose(value: unknown): number {
  if (!value) return 0;
  const v = value as { toMillis?: () => number; seconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
}
