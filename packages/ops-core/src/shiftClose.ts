/**
 * Cierre de turno: tope 12:59 y retenci?n. Copia id?ntica en
 * `apps/functions/src/scheduling/shiftCloseCore.ts` (Functions no importa packages).
 * Paridad: `node --experimental-strip-types scripts/eval-shift-close-core.mjs`.
 *
 * ?nico c?lculo de la salida real para el servidor (`buildAutoClosePatch`) y para el
 * CHECKOUT del operador en el front: nada se recalcula distinto en cada lado.
 */

/** Tope de jornada CCT: nadie supera 12 h; tolerancia de relevo hasta 12:59, nunca 13 h. */
export const SHIFT_HARD_CAP_MS = (12 * 60 + 59) * 60 * 1000;

/** Cierres por tope que llegan tarde (cron ca?do, turnos viejos abiertos): se marcan para revisi?n. */
export const STALE_CAP_GRACE_MS = 2 * 60 * 60 * 1000;

type TsLike =
  | { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
  | Date
  | number
  | string
  | null
  | undefined;

/** Timestamp (admin o cliente), Date, ms o ISO ? ms. Vac?o = 0. */
export function closeTimeMs(value: unknown): number {
  const raw = value as TsLike;
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? 0 : raw.getTime();
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof raw.toMillis === 'function') return raw.toMillis();
  if (typeof raw.toDate === 'function') return raw.toDate().getTime();
  const sec = raw.seconds ?? raw._seconds;
  return typeof sec === 'number' ? sec * 1000 : 0;
}

/** Inicio de jornada: fichada real; si no fich?, inicio planificado. */
export function shiftWorkStartMs(data: Record<string, unknown>): number {
  return closeTimeMs(data.realStartTime)
    || closeTimeMs(data.checkInTime)
    || closeTimeMs(data.presenciaAt)
    || closeTimeMs(data.startTime);
}

export function shiftHardCapAtMs(data: Record<string, unknown>): number {
  const start = shiftWorkStartMs(data);
  return start > 0 ? start + SHIFT_HARD_CAP_MS : 0;
}

export type ShiftCloseTimes = {
  /** Salida real: la pedida, acotada al tope 12:59 desde el inicio de jornada. */
  realEndMs: number;
  /** true si el tope recort? la salida pedida. */
  cappedAtMs: boolean;
  /** Solo si el turno estaba retenido: fin de la retenci?n (= salida real). */
  retentionEndedMs: number | null;
  /** Solo si estaba retenido y sali? despu?s del fin planificado: minutos retenidos. */
  retentionMinutes: number | null;
};

/**
 * C?lculo ?nico del cierre. Si `isRetention`, la retenci?n termina en la salida real y los
 * minutos se cuentan desde el fin planificado (`endTime`), como el servidor.
 */
export function computeShiftCloseTimes(
  data: Record<string, unknown>,
  requestedEndMs: number,
): ShiftCloseTimes {
  const capAt = shiftHardCapAtMs(data);
  const realEndMs = capAt > 0 ? Math.min(requestedEndMs, capAt) : requestedEndMs;
  const result: ShiftCloseTimes = {
    realEndMs,
    cappedAtMs: capAt > 0 && requestedEndMs > capAt,
    retentionEndedMs: null,
    retentionMinutes: null,
  };
  if (data.isRetention !== true) return result;
  result.retentionEndedMs = realEndMs;
  const plannedEnd = closeTimeMs(data.endTime);
  if (plannedEnd > 0 && realEndMs > plannedEnd) {
    result.retentionMinutes = Math.round((realEndMs - plannedEnd) / 60000);
  }
  return result;
}
