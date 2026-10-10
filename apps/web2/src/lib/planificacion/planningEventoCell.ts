/**
 * Turnos de EVENTO (EV) en la grilla de Planificación: solo lectura y validación.
 *
 * El turno EV lo escribe el servidor (`escribirTurnoEvento`, `origin: 'EVENTO'`, `objectiveId` del
 * evento). Acá no se crea ni se modifica: se muestra en la fila del guardia en su objetivo de base
 * como celda «EV» (tooltip de 2 s «Evento: {evento} · {servicio} · HH:MM–HH:MM», después el lugar y las alertas; sin title nativo), se marca el franco que lo originó
 * como usado y se bloquea volver a asignarlo encima (solape, descanso 12 h, mismo evento).
 */
import { isEventShift, type EventoCcShift } from '@/lib/operaciones/eventoCc';

export type TurnoEventoLike = {
  id?: unknown;
  code?: unknown;
  type?: unknown;
  origin?: unknown;
  eventoId?: unknown;
  eventoNombre?: unknown;
  servicioId?: unknown;
  servicioNombre?: unknown;
  positionName?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  isDeleted?: unknown;
  isFranco?: unknown;
  coverageUsed?: unknown;
  employeeId?: unknown;
  [key: string]: unknown;
};

export type EventoCellOverlayMode = 'EV' | 'FRANCO_USADO' | 'BADGE';

export type EventoCellOverlay = {
  ev: TurnoEventoLike;
  mode: EventoCellOverlayMode;
  /** Franco del mismo día que originó el EV (si lo hay). */
  franco: TurnoEventoLike | null;
  tooltip: string;
};

const FRANCO_CODES = new Set(['F', 'FF', 'FP']);
const NO_TRABAJA = new Set(['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'AA', 'PG', 'ART', 'LT']);
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
export const DESCANSO_MIN_HORAS = 12;

const str = (v: unknown): string => String(v ?? '').trim();

export function codigoDe(t: TurnoEventoLike | null | undefined): string {
  return str(t?.code || t?.type).toUpperCase();
}

export function isEventoTurno(t: TurnoEventoLike | null | undefined): boolean {
  if (!t || t.isDeleted === true) return false;
  return isEventShift(t as EventoCcShift);
}

export function isFrancoTurno(t: TurnoEventoLike | null | undefined): boolean {
  if (!t || t.isDeleted === true || isEventoTurno(t)) return false;
  return FRANCO_CODES.has(codigoDe(t)) || t.isFranco === true;
}

/** Primer EV del día del guardia (prefiere el que tiene `eventoId`). */
export function pickEventoTurno(cellTurnos: readonly TurnoEventoLike[] | null | undefined): TurnoEventoLike | null {
  const evs = (cellTurnos || []).filter(isEventoTurno);
  if (!evs.length) return null;
  return evs.find((e) => str(e.eventoId)) || evs[0];
}

export function pickFrancoTurno(cellTurnos: readonly TurnoEventoLike[] | null | undefined): TurnoEventoLike | null {
  return (cellTurnos || []).find(isFrancoTurno) || null;
}

export function msDe(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  const o = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof o.toDate === 'function') {
    const d = o.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  const sec = o.seconds ?? o._seconds;
  if (typeof sec === 'number' && sec > 0) return sec * 1000;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** HH:MM en hora Argentina (UTC−3 fijo). */
export function horaAr(ms: number): string {
  const d = new Date(ms - AR_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Instante AR de `HH:MM` del día `yyyy-mm-dd`. */
export function msAr(dateStr: string, hhmm: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
  const h = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim());
  if (!m || !h) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(h[1]), Number(h[2])) + AR_OFFSET_MS;
}

export function eventoHorario(ev: TurnoEventoLike | null | undefined): string {
  const ini = msDe(ev?.startTime);
  const fin = msDe(ev?.endTime);
  if (ini == null) return '';
  return fin == null ? horaAr(ini) : `${horaAr(ini)}–${horaAr(fin)}`;
}

export function eventoNombreDe(ev: TurnoEventoLike | null | undefined): string {
  return str(ev?.eventoNombre) || 'Evento';
}

export function eventoServicioDe(ev: TurnoEventoLike | null | undefined): string {
  return str(ev?.servicioNombre) || str(ev?.positionName) || '';
}

/** «{evento} · {servicio} · HH:MM–HH:MM» (sin partes vacías). */
export function eventoTooltip(ev: TurnoEventoLike | null | undefined): string {
  if (!ev) return '';
  return [eventoNombreDe(ev), eventoServicioDe(ev), eventoHorario(ev)].filter(Boolean).join(' · ');
}

/** Lugar escrito en el turno. Si no hay, la grilla completa con el nombre del objetivo. */
export function lugarEventoTurno(ev: TurnoEventoLike | null | undefined): string {
  return str(ev?.eventoLugar) || str(ev?.eventoObjectiveName) || str(ev?.objectiveName);
}

/**
 * Texto del tooltip de 2 s. Una sola pieza: primera línea el evento, el servicio y el horario;
 * después el lugar y las alertas. La marca sobre otro turno y el franco usado usan la misma primera línea.
 */
export function textoTooltipEventoCelda(input: {
  ev: TurnoEventoLike | null | undefined;
  mode?: EventoCellOverlayMode;
  lugar?: string | null;
  alertas?: readonly string[];
}): string {
  const nombre = eventoNombreDe(input.ev);
  const servicio = eventoServicioDe(input.ev);
  const horario = eventoHorario(input.ev);
  const primera = ['Evento:', [nombre, servicio, horario].filter(Boolean).join(' · ')].filter(Boolean).join(' ');
  const lineas = [primera];
  if (input.mode === 'FRANCO_USADO') lineas.push('Franco usado en evento');
  else if (input.mode === 'BADGE') lineas.push('También afectado al evento');
  const lugar = str(input.lugar);
  if (lugar && lugar !== nombre && lugar !== servicio) lineas.push(lugar);
  for (const alerta of input.alertas || []) {
    const t = str(alerta);
    if (t) lineas.push(t);
  }
  return lineas.join('\n');
}

/**
 * Qué mostrar en la celda del guardia ese día:
 *  - `EV`: no tiene otro turno (o el único doc es el EV) → celda «EV».
 *  - `FRANCO_USADO`: tenía franco y fue al evento → la celda sigue siendo F, marcada como usada.
 *  - `BADGE`: tiene otro turno de trabajo y además el EV (conflicto visible) → marca sobre la celda.
 */
export function eventoCellOverlay(
  cellTurnos: readonly TurnoEventoLike[] | null | undefined,
  baseShift: TurnoEventoLike | null | undefined,
): EventoCellOverlay | null {
  const ev = pickEventoTurno(cellTurnos);
  if (!ev) return null;
  const tooltip = eventoTooltip(ev);
  const franco = pickFrancoTurno(cellTurnos) || (isFrancoTurno(baseShift) ? baseShift! : null);
  if (franco) return { ev, mode: 'FRANCO_USADO', franco, tooltip };
  if (!baseShift || baseShift.isDeleted === true || isEventoTurno(baseShift)) return { ev, mode: 'EV', franco: null, tooltip };
  // Licencia (E, V, AA) o turno de trabajo: la celda no se pinta como EV. El evento queda en la marca.
  return { ev, mode: 'BADGE', franco: null, tooltip };
}

/**
 * Para el descanso entre turnos: si el doc “principal” del día es franco/licencia (o no hay) y el
 * guardia tiene un EV ese día, el EV es el turno que cuenta.
 */
export function pickShiftForRest<T extends TurnoEventoLike>(
  entry: T | null | undefined,
  cellTurnos: readonly TurnoEventoLike[] | null | undefined,
): T | TurnoEventoLike | null {
  const ev = pickEventoTurno(cellTurnos);
  if (!ev) return entry ?? null;
  if (!entry || entry.isDeleted === true) return ev;
  if (NO_TRABAJA.has(codigoDe(entry))) return ev;
  return entry;
}

export type AsignacionPropuesta = {
  code: string;
  /** `HH:MM` del día `dateStr`; sin horario se bloquea cualquier trabajo ese día. */
  start?: string | null;
  end?: string | null;
  eventoId?: string | null;
  servicioId?: string | null;
};

/**
 * Motivo para no asignar encima de un EV (null = se puede). Francos y licencias pasan: el franco es
 * el origen del EV y las licencias las carga RRHH.
 */
export function eventoAssignBlock(input: {
  cellTurnos: readonly TurnoEventoLike[] | null | undefined;
  dateStr: string;
  proposed: AsignacionPropuesta;
}): string | null {
  const ev = pickEventoTurno(input.cellTurnos);
  if (!ev) return null;
  const code = str(input.proposed.code).toUpperCase();
  if (!code || NO_TRABAJA.has(code)) return null;
  const tip = eventoTooltip(ev);
  if (code === 'EV') {
    const mismoEvento = str(input.proposed.eventoId) && str(input.proposed.eventoId) === str(ev.eventoId);
    const mismoServicio = !str(input.proposed.servicioId) || !str(ev.servicioId) || str(input.proposed.servicioId) === str(ev.servicioId);
    if (mismoEvento && mismoServicio) return `ALERTA CRÍTICA: ya está asignado a ese evento (${tip}).`;
  }
  const evIni = msDe(ev.startTime);
  const evFin = msDe(ev.endTime);
  const pIni = msAr(input.dateStr, input.proposed.start || '');
  let pFin = msAr(input.dateStr, input.proposed.end || '');
  if (evIni == null || evFin == null || pIni == null || pFin == null) {
    return `ALERTA CRÍTICA: ese día está afectado al evento (${tip}).`;
  }
  if (pFin <= pIni) pFin += 24 * 60 * 60 * 1000;
  if (pIni < evFin && evIni < pFin) {
    return `ALERTA CRÍTICA: se superpone con el evento (${tip}).`;
  }
  const gapMs = pIni >= evFin ? pIni - evFin : evIni - pFin;
  const gapH = gapMs / (60 * 60 * 1000);
  if (gapH < DESCANSO_MIN_HORAS) {
    return `ALERTA CRÍTICA: menos de ${DESCANSO_MIN_HORAS} h de descanso con el evento (${tip}): ${Math.floor(gapH)} h.`;
  }
  return null;
}
