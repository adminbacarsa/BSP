/**
 * Textos que el bridge le manda al guardia por privado según el resultado
 * de su foto/ubicación en Modo Rápido.
 */

import {
  candidatosTurnoWa,
  elegirTurnoWa,
  msDeRawWa,
  WA_VENTANA_INGRESO_MS,
  type TurnoWaMatch,
} from './elegirTurnoWa';

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

export function textoSinTurnoWa(nombreCompleto: string): string {
  return `❌ ${saludo(nombreCompleto)}no encontramos un turno tuyo para hoy. Si tenés que trabajar, avisá al centro de control.`;
}

export function textoYaPresenteWa(
  nombreCompleto: string,
  turno: TurnoParaRespuestaWa & { realStartTime?: string },
): string {
  const donde = turno.obj && turno.obj !== '—' ? ` en ${turno.obj}` : '';
  const desde = turno.realStartTime ? ` desde las ${turno.realStartTime}` : '';
  const fin = msDeRawWa(turno.endTimeRaw);
  const hasta = fin > 0 ? ` Termina a las ${hhmmDeMs(fin)}: la salida se avisa a partir de esa hora.` : '';
  return `✅ ${saludo(nombreCompleto)}ya estás presente${donde}${desde}.${hasta}`;
}

export function textoTurnoNoAbiertoWa(
  nombreCompleto: string,
  turnos: readonly TurnoParaRespuestaWa[],
): string {
  let finMs = 0;
  let obj = '';
  for (const t of turnos) {
    const fin = msDeRawWa(t.endTimeRaw);
    if (fin >= finMs) {
      finMs = fin;
      if (t.obj && t.obj !== '—') obj = t.obj;
    }
  }
  const donde = obj ? ` en ${obj}` : '';
  const hora = finMs > 0 ? ` a las ${hhmmDeMs(finMs)}` : '';
  return (
    `⏰ ${saludo(nombreCompleto)}no tenés un turno abierto a esta hora${donde}. ` +
    `El último terminó${hora}. Si el horario no es ese, avisá al centro de control.`
  );
}

export function textoMarcaYaRecibidaWa(nombreCompleto: string): string {
  return `📥 ${saludo(nombreCompleto)}ya recibimos tu marca de este turno. No hace falta reenviar la ubicación.`;
}

export type TurnoClasificacionWa = TurnoWaMatch & TurnoParaRespuestaWa & { realStartTime?: string };

export type AvisoWaKind =
  | 'sin_turno'
  | 'turno_cerrado'
  | 'ya_presente'
  | 'marca_recibida'
  | 'anticipado';

/**
 * Qué contestarle al guardia cuando la foto o la ubicación no se confirma sola.
 * `cortar`: no sigue como check-in. Salida (presente y ya pasó el fin) y el ingreso
 * en horario devuelven texto vacío y cortar false: los resuelve Modo Rápido.
 * `aviso`: clave para no spamear si la ubicación en vivo manda varios eventos.
 */
export function clasificarIngresoWa(input: {
  turnos: readonly TurnoClasificacionWa[];
  name: string;
  phone?: string | null;
  msgMs: number;
  yaMarcado: (rowId: string) => boolean;
}): {
  texto: string | null;
  cortar: boolean;
  turno?: TurnoClasificacionWa;
  aviso?: AvisoWaKind;
} {
  const { turnos, name, phone, msgMs, yaMarcado } = input;
  const candidatos = candidatosTurnoWa(turnos, name, phone) as TurnoClasificacionWa[];
  const turno = elegirTurnoWa(turnos, name, phone, msgMs) as TurnoClasificacionWa | undefined;
  const quien = turno?.name || name;
  if (!turno) {
    if (!candidatos.length) {
      return { texto: textoSinTurnoWa(name), cortar: true, aviso: 'sin_turno' };
    }
    return {
      texto: textoTurnoNoAbiertoWa(name, candidatos),
      cortar: true,
      aviso: 'turno_cerrado',
    };
  }
  const st = String(turno.turnoStatus || 'PENDING').toUpperCase();
  if (st === 'PRESENT') {
    const fin = msDeRawWa(turno.endTimeRaw);
    if (fin > 0 && msgMs >= fin) return { texto: null, cortar: false, turno };
    return {
      texto: textoYaPresenteWa(quien, turno),
      cortar: true,
      turno,
      aviso: 'ya_presente',
    };
  }
  if (st === 'COMPLETED' || st === 'CANCELED' || st === 'CANCELLED' || st === 'ABSENT') {
    return {
      texto: textoTurnoNoAbiertoWa(quien, [turno]),
      cortar: true,
      turno,
      aviso: 'turno_cerrado',
    };
  }
  if (turno.rowId && yaMarcado(turno.rowId)) {
    return {
      texto: textoMarcaYaRecibidaWa(quien),
      cortar: true,
      turno,
      aviso: 'marca_recibida',
    };
  }
  if (ingresoDemasiadoAnticipado(turno.startTimeRaw, msgMs)) {
    return {
      texto: textoIngresoAnticipadoWa(quien, turno, msgMs),
      cortar: false,
      turno,
      aviso: 'anticipado',
    };
  }
  return { texto: null, cortar: false, turno };
}
