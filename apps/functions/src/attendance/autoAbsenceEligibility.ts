/**
 * Jornada plausible para la ausencia automática (T+30 / ETA vencida).
 *
 * Antes `detectarAusencias` salteaba todo turno cuyo fin estaba a más de 6 h: un turno
 * de 8 h a T+30 tiene 7 h 30 por delante, así que nunca recibía AUTO_T30 hasta T+2 h
 * (auditoría 29/09/2026, Obrador Malagueño: tres T 16:00–00:00 sin AA hasta que el
 * operador los marcó a mano a las 18:30). La guardia real que se quería es "no marcar
 * ausente un doc de 24 h" (francos, licencias, registros): eso lo decide la duración,
 * no cuánto falta para el fin.
 */
export const AUTO_ABSENCE_MAX_SPAN_MS = 13 * 60 * 60 * 1000;

/** `true` si el doc tiene una duración de jornada (≤ 13 h) o no tiene fin conocido. Duración 0 no. */
export function isAutoAbsenceSpanPlausible(startMs: number, endMs: number): boolean {
  if (!startMs || !endMs) return true;
  const span = endMs - startMs;
  if (span === 0) return false;
  if (span < 0) return true;
  return span <= AUTO_ABSENCE_MAX_SPAN_MS;
}
