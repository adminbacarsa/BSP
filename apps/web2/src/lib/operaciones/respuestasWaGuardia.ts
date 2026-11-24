/**
 * Textos que el bridge le manda al guardia por privado según el resultado
 * de su foto/ubicación en Modo Rápido.
 */

import { msDeRawWa, WA_VENTANA_INGRESO_MS } from './elegirTurnoWa';

export { WA_VENTANA_INGRESO_MS };

export const WA_RADIO_MAX_M = 80;

export type TurnoParaRespuestaWa = {
  expected?: string;
  obj?: string;
  startTimeRaw?: unknown;
  endTimeRaw?: unknown;
  bloque?: number;
  bloquesTotal?: number;
};

function nombrePila(nombreCompleto: string): string {
  const crudo = String(nombreCompleto || '').trim();
  const pila = (crudo.includes(',') ? crudo.split(',')[1] : crudo).trim().split(/\s+/)[0] || '';
  return pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '';
}

function saludo(nombreCompleto: string): string {
  const n = nombrePila(nombreCompleto);
  return n ? `${n}, ` : '';
}

function hhmmDeMs(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

export function minutosAntesDelInicio(startMs: number, msgMs: number): number {
  if (!startMs || startMs <= 0) return 0;
  return Math.max(0, Math.round((startMs - msgMs) / 60000));
}

/** True si la marca es más de 30 min antes del inicio planificado. */
export function ingresoDemasiadoAnticipado(
  startTimeRaw: unknown,
  msgMs: number,
): boolean {
  const start = msDeRawWa(startTimeRaw);
  if (!start) return false;
  return msgMs < start - WA_VENTANA_INGRESO_MS;
}

export function textoConfirmacionIngresoWa(
  nombreCompleto: string,
  hora: string,
  turno?: TurnoParaRespuestaWa,
): string {
  const tramo =
    turno && turno.bloquesTotal && turno.bloquesTotal > 1 && turno.bloque
      ? ` (tramo ${turno.bloque} de ${turno.bloquesTotal})`
      : '';
  const donde = turno?.obj && turno.obj !== '—' ? ` en ${turno.obj}` : '';
  return `✅ ${saludo(nombreCompleto)}recibimos tu ingreso y se confirmó tu presencia a las ${hora}${tramo}${donde}. ¡Gracias!`;
}

export function textoIngresoAnticipadoWa(
  nombreCompleto: string,
  turno: TurnoParaRespuestaWa,
  msgMs: number,
): string {
  const start = msDeRawWa(turno.startTimeRaw);
  const horaInicio = turno.expected || (start > 0 ? hhmmDeMs(start) : '—');
  const desde = start > 0 ? hhmmDeMs(start - WA_VENTANA_INGRESO_MS) : '—';
  const mins = start > 0 ? minutosAntesDelInicio(start, msgMs) : 0;
  const donde = turno.obj && turno.obj !== '—' ? ` (${turno.obj})` : '';
  return (
    `⏰ ${saludo(nombreCompleto)}tu turno empieza a las ${horaInicio}${donde}. ` +
    `Podés marcar presencia desde las ${desde} (hasta 30 min antes). ` +
    (mins > 30 ? `Marcaste ~${mins} min antes. ` : '') +
    `Reenviá tu ubicación en tiempo real a esa hora.`
  );
}

export function textoFueraDeRadioWa(
  nombreCompleto: string,
  distM: number,
  para: 'ingreso' | 'salida' = 'ingreso',
): string {
  const que = para === 'salida' ? 'la salida' : 'el ingreso';
  return (
    `📍 ${saludo(nombreCompleto)}tu ubicación está a ${distM} m del objetivo ` +
    `(máximo ${WA_RADIO_MAX_M} m). Acercate al puesto y reenviá tu *ubicación en tiempo real* para registrar ${que}.`
  );
}

export function textoSalidaRegistradaWa(nombreCompleto: string, hora: string): string {
  const n = nombrePila(nombreCompleto);
  return `🚪 Salida registrada a las ${hora}. Gracias${n ? `, ${n}` : ''}.`;
}

export function textoSalidaAntesDeFinWa(
  nombreCompleto: string,
  finHhmm: string,
): string {
  return (
    `⏰ ${saludo(nombreCompleto)}tu turno termina a las ${finHhmm}. ` +
    `Podés avisar la salida a partir de esa hora. Reenviá tu ubicación cuando finalice.`
  );
}
