/** Ventanas del aviso de llegada. El cron es de 1 min: el ¿Venís? cabe en el tick de T. */

export const HEADS_UP_BEFORE_MS = 5 * 60 * 1000;
/** Un tick perdido del scheduler de 1 min sigue siendo «en punto». */
export const VENIS_GRACE_MS = 70 * 1000;

export type ArrivalNoticeKind = 'HEADS_UP' | 'VENIS';

/**
 * HEADS_UP: [T−5, T) — «¿estás llegando?», nunca después del inicio.
 * VENIS: [T, T+70s] — «¿Venís?» si no fichó.
 */
export function classifyArrivalNotice(startMs: number, nowMs: number): ArrivalNoticeKind | null {
  if (!startMs || !nowMs) return null;
  const delta = nowMs - startMs;
  if (delta >= -HEADS_UP_BEFORE_MS && delta < 0) return 'HEADS_UP';
  if (delta >= 0 && delta <= VENIS_GRACE_MS) return 'VENIS';
  return null;
}

export function lugarAviso(parts: {
  clientName?: unknown;
  objectiveName?: unknown;
  positionName?: unknown;
}): string {
  return [parts.clientName, parts.objectiveName, parts.positionName]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
}

export function headsUpBody(hora: string, lugar: string, name?: string): string {
  const donde = lugar ? ` en ${lugar}` : '';
  const hello = name ? `Hola ${name} 👋 ` : '';
  return `${hello}Tu turno arranca a las ${hora}${donde}. ¿Ya estás llegando?`;
}

export function venisBody(_codigo: string, lugar: string, hora: string, name?: string): string {
  const donde = lugar ? ` en ${lugar}` : '';
  const who = name ? `${name}, ¿venís?` : '¿Venís?';
  return `${who} Tu turno empezó a las ${hora}${donde}. Contanos si llegás en 10, 15 o 30 min.`;
}
