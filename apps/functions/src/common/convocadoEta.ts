/**
 * ETA del convocado: colectivo (~20 km/h) + espera. Espejo en functions/src/common.
 * ESC/REF en el mismo objetivo no viajan.
 */

export const CONVOCADO_ETA_SPEED_KMH = 20;
export const CONVOCADO_ETA_WAIT_MIN = 10;
export const CONVOCADO_SAME_SITE_ETA_MIN = 5;
export const CONVOCADO_DELAY_GRACE_MIN = 15;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number | null {
  if (![lat1, lon1, lat2, lon2].every((n) => Number.isFinite(n))) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Minutos de viaje + espera. Sin distancia, solo la espera. */
export function busEtaMinutes(
  distanceKm: number | null,
  speedKmh = CONVOCADO_ETA_SPEED_KMH,
  waitMin = CONVOCADO_ETA_WAIT_MIN,
): number {
  const speed = speedKmh > 0 ? speedKmh : CONVOCADO_ETA_SPEED_KMH;
  const wait = waitMin >= 0 ? waitMin : CONVOCADO_ETA_WAIT_MIN;
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0.05) return Math.max(1, Math.round(wait));
  return Math.max(1, Math.round((distanceKm / speed) * 60 + wait));
}

export function convocadoTravelEta(input: {
  coverageType: string;
  sameObjective: boolean;
  distanceKm: number | null;
  speedKmh?: number;
  waitMin?: number;
}): { etaMinutes: number; traveled: boolean } {
  const ct = String(input.coverageType || '').toUpperCase();
  if ((ct === 'ESC' || ct === 'REF') && input.sameObjective) {
    return { etaMinutes: CONVOCADO_SAME_SITE_ETA_MIN, traveled: false };
  }
  return {
    etaMinutes: busEtaMinutes(input.distanceKm, input.speedKmh, input.waitMin),
    traveled: true,
  };
}

/** Recordatorio a los 2/3 del ETA, contado desde la aceptación (hueco ya empezado). */
export function convocadoReminderAtMs(acceptedAtMs: number, etaMinutes: number): number {
  const eta = Math.max(1, etaMinutes);
  return acceptedAtMs + Math.round((eta * 2) / 3) * 60 * 1000;
}

export const CONVOCADO_REMINDER_LEAD_MIN = 10;
export const CONVOCADO_PUNCH_LEAD_MIN = 15;

/** Más de este margen antes del inicio: la cobertura es un cambio de planificación. */
export const UMBRAL_COBERTURA_ANTICIPADA_MIN = 60;

export type EscenarioCobertura = 'ANTICIPADA' | 'URGENTE';

/**
 * ANTICIPADA si falta estrictamente más que el umbral (default 60 min).
 * URGENTE si falta el umbral o menos, o el hueco ya empezó.
 */
export function escenarioCobertura(input: {
  gapStartMs: number;
  nowMs: number;
  umbralMin?: number | null;
}): EscenarioCobertura {
  const raw = Number(input.umbralMin);
  const umbral = Number.isFinite(raw) && raw >= 0 ? raw : UMBRAL_COBERTURA_ANTICIPADA_MIN;
  const gap = input.gapStartMs;
  const now = input.nowMs;
  if (gap > 0 && now > 0 && gap - now > umbral * 60_000) return 'ANTICIPADA';
  return 'URGENTE';
}

/** El saliente se retiene si el hueco ya empezó o empieza antes de que llegue quien cubre. */
export function retenerSalientePorLlegada(input: {
  gapStartMs: number;
  nowMs: number;
  etaMinutes: number;
}): boolean {
  const gap = input.gapStartMs;
  const now = input.nowMs;
  if (!(gap > 0) || !(now > 0)) return false;
  if (gap <= now) return true;
  const eta = Math.max(1, Math.round(Number(input.etaMinutes) || 0));
  return gap < now + eta * 60_000;
}

export type ConvocadoArrivalPlan = {
  /** El hueco empieza después de aceptación + viaje: la llegada es el inicio, no “ya”. */
  future: boolean;
  expectedArrivalMs: number;
  reminderAtMs: number;
  /** Momento de salir: inicio del hueco menos el viaje. */
  departAtMs: number;
  /** Apertura de fichada. */
  punchOpenMs: number;
};

/**
 * Hueco futuro (inicio > aceptación + viaje): llegada = inicio, recordatorio = salida − 10 min
 * (si eso ya pasó, T−5), fichada desde T−15. Hueco ya empezado: llegada = aceptación + viaje
 * y recordatorio a los 2/3.
 */
export function planConvocadoArrival(input: {
  acceptedAtMs: number;
  gapStartMs: number;
  etaMinutes: number;
  /**
   * REF/ESC/RET: URGENTE ficha desde la asignación (recordatorio a los 2/3),
   * aunque el viaje entre antes del inicio. Sin esto, sigue la regla de viaje (FT y el resto).
   */
  escenario?: EscenarioCobertura | null;
}): ConvocadoArrivalPlan & { escenario?: EscenarioCobertura } {
  const eta = Math.max(1, Math.round(Number(input.etaMinutes) || 0));
  const travelMs = eta * 60_000;
  const accepted = input.acceptedAtMs;
  const gap = input.gapStartMs;
  if (input.escenario === 'URGENTE') {
    return {
      escenario: 'URGENTE',
      future: false,
      expectedArrivalMs: accepted + travelMs,
      reminderAtMs: convocadoReminderAtMs(accepted, eta),
      departAtMs: accepted,
      punchOpenMs: accepted,
    };
  }
  if (input.escenario === 'ANTICIPADA') {
    return {
      escenario: 'ANTICIPADA',
      future: false,
      expectedArrivalMs: gap,
      reminderAtMs: 0,
      departAtMs: gap,
      punchOpenMs: gap > 0 ? gap - CONVOCADO_PUNCH_LEAD_MIN * 60_000 : accepted,
    };
  }
  const future = gap > 0 && accepted > 0 && gap > accepted + travelMs;
  if (!future) {
    return {
      future: false,
      expectedArrivalMs: accepted + travelMs,
      reminderAtMs: convocadoReminderAtMs(accepted, eta),
      departAtMs: accepted,
      punchOpenMs: accepted,
    };
  }
  let reminderAtMs = gap - travelMs - CONVOCADO_REMINDER_LEAD_MIN * 60_000;
  const tMinus5 = gap - 5 * 60_000;
  if (reminderAtMs <= accepted) reminderAtMs = tMinus5 > accepted ? tMinus5 : accepted + 60_000;
  return {
    future: true,
    expectedArrivalMs: gap,
    reminderAtMs,
    departAtMs: gap - travelMs,
    punchOpenMs: gap - CONVOCADO_PUNCH_LEAD_MIN * 60_000,
  };
}
