/**
 * Puntaje de desempeño de guardias y eventuales. Función pura: no lee Firestore.
 * Ventana móvil de 90 días. Dos componentes 0–100 y un total ponderado.
 * Siempre se recalcula desde los hechos (idempotente): no acumula sobre el doc anterior.
 *
 * Cumplimiento arranca en 100 y baja. Disposición arranca en 50 y se mueve para los dos lados.
 * Las licencias justificadas del guardia no bajan. El eventual no tiene justificación.
 */
export const PUNTAJE_VENTANA_DIAS = 90;
export const PESO_CUMPLIMIENTO = 0.6;
export const PESO_DISPOSICION = 0.4;
export const CUMPLIMIENTO_BASE = 100;
export const DISPOSICION_BASE = 50;

export const PUNTAJE_DELTAS = {
  FALTA_SIN_AVISO: -15,
  LLEGADA_TARDE_SIN_AVISO: -8,
  CANCELACION_TARDIA: -12,
  ABANDONO: -20,
  FT_ACEPTADO: 8,
  EXT_ACEPTADO: 6,
  ADV_ACEPTADO: 6,
  CONVOCATORIA_ACEPTADA: 5,
  EVENTO_ACEPTADO: 5,
  CONVOCATORIA_RECHAZADA: -4,
  CONVOCATORIA_SIN_RESPUESTA: -3,
} as const;

export type TipoHecho = keyof typeof PUNTAJE_DELTAS;

export const LICENCIAS_JUSTIFICADAS = new Set(['E', 'L', 'A', 'V', 'PG', 'ART', 'SGS', 'SUS']);

const CUMPLIMIENTO: ReadonlySet<TipoHecho> = new Set([
  'FALTA_SIN_AVISO', 'LLEGADA_TARDE_SIN_AVISO', 'CANCELACION_TARDIA', 'ABANDONO',
]);

export const ETIQUETA_HECHO: Record<TipoHecho, string> = {
  FALTA_SIN_AVISO: 'Falta sin aviso',
  LLEGADA_TARDE_SIN_AVISO: 'Llegada tarde sin aviso',
  CANCELACION_TARDIA: 'Canceló con menos de 24 h',
  ABANDONO: 'Abandono o retiro',
  FT_ACEPTADO: 'Cubrió en franco (FT)',
  EXT_ACEPTADO: 'Aceptó extensión',
  ADV_ACEPTADO: 'Aceptó adelanto',
  CONVOCATORIA_ACEPTADA: 'Aceptó convocatoria',
  EVENTO_ACEPTADO: 'Aceptó evento',
  CONVOCATORIA_RECHAZADA: 'Rechazó convocatoria',
  CONVOCATORIA_SIN_RESPUESTA: 'No respondió convocatoria',
};

const CANCELACION_TARDIA_MS = 24 * 60 * 60 * 1000;
const TARDE_GRACIA_MS = 5 * 60 * 1000;

export interface HechoDesempeno {
  tipo: TipoHecho;
  fechaMs: number;
  ref: string;
  esEventual: boolean;
}

export interface DetallePuntaje {
  tipo: TipoHecho;
  componente: 'CUMPLIMIENTO' | 'DISPOSICION';
  delta: number;
  fechaMs: number;
  ref: string;
  etiqueta: string;
}

export interface PuntajeCalculado {
  total: number;
  cumplimiento: number;
  disposicion: number;
  pesos: { cumplimiento: number; disposicion: number };
  ventanaDias: number;
  ventanaDesdeMs: number;
  detalle: DetallePuntaje[];
}

export interface FuenteTurno {
  id: string;
  employeeId?: string | null;
  bolsaCuil?: string | null;
  esEventual?: boolean;
  startMs: number;
  code?: string | null;
  isAbsent?: boolean;
  isPresent?: boolean;
  draft?: boolean;
  lateMinutes?: number | null;
  checkInMs?: number | null;
  avisoLlegada?: boolean;
  completionReason?: string | null;
  earlyWithdrawReason?: string | null;
}

export interface FuenteAusencia {
  id: string;
  employeeId?: string | null;
  shiftId?: string | null;
  bolsaCuil?: string | null;
  esEventual?: boolean;
  code?: string | null;
  origin?: string | null;
  fechaMs: number;
  reverted?: boolean;
}

export interface FuenteConvocatoria {
  id: string;
  employeeId?: string | null;
  bolsaCuil?: string | null;
  tipo?: string | null;
  status?: string | null;
  fechaMs: number;
  startMs?: number | null;
  acceptedAtMs?: number | null;
  cancelledAtMs?: number | null;
  eventoId?: string | null;
  respondedBy?: string | null;
  esEventual?: boolean;
}

export interface FuenteSolicitudEvento {
  id: string;
  empleadoId?: string | null;
  status?: string | null;
  fechaMs: number;
  eventoId?: string | null;
}

/** Lo que escribe el agente de Eventuales. Ver `docs` en CLAUDE.md: colección guardia_desempeno_eventos. */
export interface FuenteDesempenoEvento {
  id: string;
  empleadoId?: string | null;
  bolsaCuil?: string | null;
  tipo?: string | null;
  fechaMs: number;
  turnoId?: string | null;
  eventoId?: string | null;
  esEventual?: boolean;
}

export interface FuentesDesempeno {
  turnos?: FuenteTurno[];
  ausencias?: FuenteAusencia[];
  convocatorias?: FuenteConvocatoria[];
  solicitudesEvento?: FuenteSolicitudEvento[];
  eventos?: FuenteDesempenoEvento[];
}

export function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function tiempoMs(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === 'object') {
    const row = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof row.toMillis === 'function') return row.toMillis();
    const seconds = row.seconds ?? row._seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }
  return 0;
}

function codigo(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function esDemo(respondedBy: unknown): boolean {
  return codigo(respondedBy) === 'MODO_DEMO';
}

function esTipo(value: unknown): value is TipoHecho {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PUNTAJE_DELTAS, value);
}

function refDe(...partes: Array<string | null | undefined>): string {
  return partes.map((p) => String(p || '').trim()).find(Boolean) || '';
}

/**
 * Hechos que mueven el puntaje, deduplicados por tipo + referencia.
 * Una falta y un abandono del mismo turno cuentan una sola vez (queda el abandono).
 */
export function hechosDesdeFuentes(fuentes: FuentesDesempeno): HechoDesempeno[] {
  const porClave = new Map<string, HechoDesempeno>();
  const poner = (hecho: HechoDesempeno) => {
    const ref = hecho.ref || `${hecho.tipo}:${hecho.fechaMs}`;
    const clave = `${hecho.tipo}|${ref}`;
    if (!porClave.has(clave)) porClave.set(clave, { ...hecho, ref });
  };

  for (const ev of fuentes.eventos || []) {
    if (!esTipo(ev.tipo) || !ev.fechaMs) continue;
    poner({
      tipo: ev.tipo,
      fechaMs: ev.fechaMs,
      ref: refDe(ev.turnoId, ev.eventoId, ev.id),
      esEventual: ev.esEventual === true || !!ev.bolsaCuil,
    });
  }

  for (const aus of fuentes.ausencias || []) {
    if (aus.reverted || !aus.fechaMs) continue;
    const eventual = aus.esEventual === true;
    const code = codigo(aus.code);
    const origin = codigo(aus.origin);
    if (!eventual && LICENCIAS_JUSTIFICADAS.has(code)) continue;
    const falta = code === 'AA' || origin === 'AUTO_T30' || origin === 'AUSENCIA_AUTO';
    if (!eventual && !falta) continue;
    poner({
      tipo: 'FALTA_SIN_AVISO',
      fechaMs: aus.fechaMs,
      ref: refDe(aus.shiftId, aus.id),
      esEventual: eventual,
    });
  }

  for (const turno of fuentes.turnos || []) {
    if (turno.draft || !turno.startMs) continue;
    const eventual = turno.esEventual === true;
    const ref = turno.id;
    const retiro = codigo(turno.earlyWithdrawReason || turno.completionReason);
    if (retiro === 'ABANDONO') {
      poner({ tipo: 'ABANDONO', fechaMs: turno.startMs, ref, esEventual: eventual });
      porClave.delete(`FALTA_SIN_AVISO|${ref}`);
    }
    const tarde = (Number(turno.lateMinutes) || 0) > 0
      || (turno.checkInMs != null && turno.checkInMs > turno.startMs + TARDE_GRACIA_MS);
    if (turno.isPresent && tarde && !turno.avisoLlegada && !turno.isAbsent && retiro !== 'ABANDONO') {
      poner({ tipo: 'LLEGADA_TARDE_SIN_AVISO', fechaMs: turno.checkInMs || turno.startMs, ref, esEventual: eventual });
    }
  }

  for (const conv of fuentes.convocatorias || []) {
    if (esDemo(conv.respondedBy) || !conv.fechaMs) continue;
    const eventual = conv.esEventual === true || codigo(conv.tipo) === 'EVENTUAL';
    const status = codigo(conv.status);
    const tipo = codigo(conv.tipo);
    const ref = refDe(conv.eventoId, conv.id);
    const canceloTarde = status === 'CANCELLED'
      && conv.acceptedAtMs
      && conv.cancelledAtMs
      && conv.cancelledAtMs > conv.acceptedAtMs
      && conv.startMs
      && conv.startMs - conv.cancelledAtMs >= 0
      && conv.startMs - conv.cancelledAtMs < CANCELACION_TARDIA_MS;
    if (status === 'ACCEPTED' || canceloTarde) {
      const aceptado: TipoHecho = conv.eventoId
        ? 'EVENTO_ACEPTADO'
        : tipo === 'FT' ? 'FT_ACEPTADO'
          : tipo === 'EXTEND' || tipo === 'EXT' ? 'EXT_ACEPTADO'
            : tipo === 'ADVANCE' || tipo === 'ADV' ? 'ADV_ACEPTADO'
              : 'CONVOCATORIA_ACEPTADA';
      poner({ tipo: aceptado, fechaMs: conv.acceptedAtMs || conv.fechaMs, ref, esEventual: eventual });
      if (canceloTarde) {
        poner({ tipo: 'CANCELACION_TARDIA', fechaMs: conv.cancelledAtMs as number, ref, esEventual: eventual });
      }
    } else if (status === 'REJECTED') {
      poner({ tipo: 'CONVOCATORIA_RECHAZADA', fechaMs: conv.fechaMs, ref, esEventual: eventual });
    } else if (status === 'TIMEOUT') {
      poner({ tipo: 'CONVOCATORIA_SIN_RESPUESTA', fechaMs: conv.fechaMs, ref, esEventual: eventual });
    }
  }

  for (const sol of fuentes.solicitudesEvento || []) {
    if (!sol.fechaMs) continue;
    const status = codigo(sol.status);
    const ref = refDe(sol.eventoId, sol.id);
    if (status === 'ACEPTADA' || status === 'APROBADA' || status === 'ASIGNADA') {
      poner({ tipo: 'EVENTO_ACEPTADO', fechaMs: sol.fechaMs, ref, esEventual: false });
    } else if (status === 'RECHAZADA') {
      poner({ tipo: 'CONVOCATORIA_RECHAZADA', fechaMs: sol.fechaMs, ref, esEventual: false });
    }
  }

  return [...porClave.values()].sort((a, b) => a.fechaMs - b.fechaMs || a.tipo.localeCompare(b.tipo));
}

export function calcularPuntaje(hechos: HechoDesempeno[], ahoraMs: number): PuntajeCalculado {
  const desde = ahoraMs - PUNTAJE_VENTANA_DIAS * 24 * 60 * 60 * 1000;
  let cumplimiento = CUMPLIMIENTO_BASE;
  let disposicion = DISPOSICION_BASE;
  const detalle: DetallePuntaje[] = [];
  for (const hecho of hechos) {
    if (hecho.fechaMs < desde || hecho.fechaMs > ahoraMs) continue;
    const delta = PUNTAJE_DELTAS[hecho.tipo];
    const componente = CUMPLIMIENTO.has(hecho.tipo) ? 'CUMPLIMIENTO' : 'DISPOSICION';
    if (componente === 'CUMPLIMIENTO') cumplimiento += delta;
    else disposicion += delta;
    detalle.push({
      tipo: hecho.tipo,
      componente,
      delta,
      fechaMs: hecho.fechaMs,
      ref: hecho.ref,
      etiqueta: ETIQUETA_HECHO[hecho.tipo],
    });
  }
  cumplimiento = clamp100(cumplimiento);
  disposicion = clamp100(disposicion);
  const total = clamp100(cumplimiento * PESO_CUMPLIMIENTO + disposicion * PESO_DISPOSICION);
  detalle.sort((a, b) => b.fechaMs - a.fechaMs);
  return {
    total,
    cumplimiento,
    disposicion,
    pesos: { cumplimiento: PESO_CUMPLIMIENTO, disposicion: PESO_DISPOSICION },
    ventanaDias: PUNTAJE_VENTANA_DIAS,
    ventanaDesdeMs: desde,
    detalle,
  };
}

export function calcularPuntajeDeFuentes(fuentes: FuentesDesempeno, ahoraMs: number): PuntajeCalculado {
  return calcularPuntaje(hechosDesdeFuentes(fuentes), ahoraMs);
}
