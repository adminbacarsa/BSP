/**
 * Extensión de cobertura cargada como la TURA: +1…+4 h pegadas al turno,
 * antes del ingreso (adelanto) o después del egreso (extensión).
 * Cobertura acredita el hueco y no suma sobre lo vendido.
 * TURA sigue facturando aparte (turno propio).
 */

import { avisoJornadaTura, tramoTura, type LadoTura, type TuraPendiente } from './turaRapido';

export const HORAS_EXT_COBERTURA = [1, 2, 3, 4] as const;

export type TipoAgregado = 'cobertura' | 'tura';

export type SiglaAgregado = 'EXT' | 'ADEL' | 'TURA';

const TOPE_MES = 200;
const DESCANSO_MIN_H = 8;

export function esBandaNocheCodigo(code: unknown): boolean {
  const c = String(code || '').trim().toUpperCase();
  if (c === 'N' || c === 'N12') return true;
  if (c === 'EN' || c === 'ENC') return false;
  return c.length > 1 && c.endsWith('N');
}

export function siglaAgregado(t: {
  isExtended?: boolean;
  isEarlyStart?: boolean;
  isTura?: boolean;
  code?: string;
} | null | undefined): SiglaAgregado | '' {
  if (!t) return '';
  if (t.isTura === true || String(t.code || '').toUpperCase() === 'TURA') return 'TURA';
  if (t.isEarlyStart && !t.isExtended) return 'ADEL';
  if (t.isExtended) return 'EXT';
  return '';
}

export function textoExtCobertura(code: string, inicio: string, fin: string, t: TuraPendiente): string {
  const tramo = tramoTura(inicio, fin, t);
  if (!tramo || t.horas < 1 || t.horas > 4) return '';
  const sigla = t.lado === 'antes' ? 'ADEL' : 'EXT';
  return `${sigla} ${tramo.startTime}–${tramo.endTime} (${t.horas} h, ${t.lado === 'antes' ? 'antes' : 'después'} del ${code})`;
}

export type CamposExtCobertura = {
  isExtended: boolean;
  isEarlyStart: boolean;
  isTura: false;
  segmentFromTime: string;
  segmentToTime: string;
  extExtraHours: number;
  coverageSegmentRole: 'EXTENSION' | 'EARLY_START';
  coverageType: 'ABSENCE_COVERAGE';
  coverageNote: string;
  adjustedEndTime?: string;
  adjustedStartTime?: string;
};

/** Campos que ya lee `extEntrePuestos` y el guardado del turno. No es un documento nuevo. */
export function camposExtCobertura(code: string, inicio: string, fin: string, t: TuraPendiente): CamposExtCobertura | null {
  if (t.horas < 1 || t.horas > 4) return null;
  const tramo = tramoTura(inicio, fin, t);
  if (!tramo) return null;
  const adel = t.lado === 'antes';
  return {
    isExtended: !adel,
    isEarlyStart: adel,
    isTura: false,
    segmentFromTime: tramo.startTime,
    segmentToTime: tramo.endTime,
    extExtraHours: t.horas,
    coverageSegmentRole: adel ? 'EARLY_START' : 'EXTENSION',
    coverageType: 'ABSENCE_COVERAGE',
    coverageNote: textoExtCobertura(code, inicio, fin, t),
    ...(adel ? { adjustedStartTime: tramo.startTime } : { adjustedEndTime: tramo.endTime }),
  };
}

type Reloj = { startTime: string; endTime: string };

function aMin(hm: string): number | null {
  const m = String(hm || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function rangosEnDia(inicio: string, fin: string): Array<[number, number]> {
  const a = aMin(inicio);
  const b = aMin(fin);
  if (a == null || b == null || a === b) return [];
  if (b > a) return [[a, b]];
  return [[a, 1440], [0, b]];
}

function seCruzan(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x[0] < y[1] && y[0] < x[1]) return true;
    }
  }
  return false;
}

export function tramoPisaNoche(
  tramo: { startTime: string; endTime: string },
  noches: ReadonlyArray<{ startTime: string; endTime: string }>,
): boolean {
  const propio = rangosEnDia(tramo.startTime, tramo.endTime);
  if (!propio.length) return false;
  return noches.some((n) => seCruzan(propio, rangosEnDia(n.startTime, n.endTime)));
}

function finAbsoluto(diaBase: number, start: string, end: string): number | null {
  const a = aMin(start);
  let b = aMin(end);
  if (a == null || b == null) return null;
  if (b <= a) b += 1440;
  return diaBase + b;
}

/** Límites del turno ya con el agregado, en minutos (hoy = 1440). */
export function limitesAgregado(inicio: string, fin: string, lado: LadoTura, horas: number): { startAbs: number; endAbs: number } | null {
  const a = aMin(inicio);
  let b = aMin(fin);
  if (a == null || b == null || horas < 1) return null;
  if (b <= a) b += 1440;
  let start = 1440 + a;
  let end = 1440 + b;
  const delta = Math.round(horas) * 60;
  if (lado === 'antes') start -= delta;
  else end += delta;
  return { startAbs: start, endAbs: end };
}

export function rechazoDescansoAgregado(
  inicio: string,
  fin: string,
  lado: LadoTura,
  horas: number,
  previo?: Reloj | null,
  siguiente?: Reloj | null,
): string {
  const lim = limitesAgregado(inicio, fin, lado, horas);
  if (!lim) return '';
  if (previo?.startTime && previo.endTime) {
    const prevEnd = finAbsoluto(0, previo.startTime, previo.endTime);
    if (prevEnd != null) {
      const h = Math.round(((lim.startAbs - prevEnd) / 60) * 10) / 10;
      if (h < DESCANSO_MIN_H) return `Quedan ${String(h).replace('.', ',')} h de descanso: con menos de 8 h no se carga.`;
    }
  }
  if (siguiente?.startTime) {
    const nextIni = aMin(siguiente.startTime);
    if (nextIni != null) {
      const h = Math.round((((2880 + nextIni) - lim.endAbs) / 60) * 10) / 10;
      if (h < DESCANSO_MIN_H) return `Quedan ${String(h).replace('.', ',')} h de descanso: con menos de 8 h no se carga.`;
    }
  }
  return '';
}

type TurnoExtraDia = {
  isDeleted?: boolean;
  isExtended?: boolean;
  isEarlyStart?: boolean;
  extExtraHours?: number;
} | null | undefined;

/** Horas extra ya sumadas en ese día: el borrador si existe, si no lo guardado. */
export function horasExtraYaDelDia(borrador: TurnoExtraDia, guardado: TurnoExtraDia): number {
  const fuente = borrador && !borrador.isDeleted ? borrador : guardado;
  if (!fuente || fuente.isDeleted) return 0;
  if (!fuente.isExtended && !fuente.isEarlyStart) return 0;
  const n = Number(fuente.extExtraHours);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type ValidacionAgregado = {
  tipo: TipoAgregado;
  inicio: string;
  fin: string;
  lado: LadoTura;
  horas: number;
  bloqueado?: boolean;
  mensajeBloqueo?: string;
  /** Horas del ciclo CCT 26→25 que ya incluyen el extra de este día, si el día cae en ese ciclo. */
  horasMes?: number;
  horasExtraYaContadas?: number;
  topeMes?: number;
  /** Legajo con PIN / authorizedOver200: el tope de 200 h no bloquea. */
  topeAutorizado?: boolean;
  /** false si el día cae fuera del ciclo cuyas horas vienen en horasMes (26–fin → ciclo siguiente). */
  diaEnCiclo?: boolean;
  previo?: Reloj | null;
  siguiente?: Reloj | null;
  bandasNoche?: ReadonlyArray<{ startTime: string; endTime: string }>;
};

/** Vacío si se puede cargar. Si no, el motivo del rechazo. */
export function validarCargaAgregado(v: ValidacionAgregado): string {
  if (v.bloqueado) return v.mensajeBloqueo || 'Cronograma bloqueado: no se cargan horas.';
  const max = v.tipo === 'cobertura' ? 4 : 8;
  if (v.horas < 1 || v.horas > max) {
    return v.tipo === 'cobertura' ? 'La cobertura es de 1 a 4 h.' : 'El TURA es de 1 a 8 h.';
  }
  const jornada = avisoJornadaTura(v.inicio, v.fin, v.horas);
  if (jornada) return jornada;
  const descanso = rechazoDescansoAgregado(v.inicio, v.fin, v.lado, v.horas, v.previo, v.siguiente);
  if (descanso) return descanso;
  const tope = v.topeMes && v.topeMes > 0 ? v.topeMes : TOPE_MES;
  if (!v.topeAutorizado && v.diaEnCiclo !== false) {
    const ya = Number(v.horasMes) || 0;
    const previas = Number(v.horasExtraYaContadas) || 0;
    const queda = Math.round((ya - previas + v.horas) * 10) / 10;
    if (queda > tope) return `Quedaría en ${queda} h: pasa el tope de ${tope} h.`;
  }
  if (v.tipo === 'cobertura') {
    const tramo = tramoTura(v.inicio, v.fin, { lado: v.lado, horas: v.horas });
    if (tramo && tramoPisaNoche(tramo, v.bandasNoche || [])) return 'La N no se cubre con extensión ni adelanto.';
  }
  return '';
}
