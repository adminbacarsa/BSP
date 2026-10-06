import { addShiftToOpsBucket, shiftMatchesOpsViewTab } from '@cosp/ops-core';

/**
 * Eventos en el Centro de Control (lista, celular y mapa).
 *
 * Un turno EV se agrupa SIEMPRE bajo «Evento: {evento} · {servicio}», ubicado donde está el
 * evento (objetivo del evento o coordenadas del doc `eventos`), nunca bajo el objetivo de base
 * del guardia. Soporta los shapes históricos del turno EV:
 *  - `objectiveId` = objetivo de base del guardia (eventoAssignService / eventoAssignAdmin);
 *  - sin `objectiveId` (eventual de la bolsa);
 *  - `objectiveId` = objetivo del evento;
 *  - shape unificado: `eventoId`, `servicioId`, `positionName` = servicio, `objectiveId` = objetivo
 *    del evento con coords (y opcionalmente `eventoObjectiveId` / `eventoLat` / `eventoLng`).
 */

export interface EventoCcShift {
  id?: string;
  code?: unknown;
  origin?: unknown;
  eventoId?: unknown;
  eventoNombre?: unknown;
  servicioId?: unknown;
  servicioNombre?: unknown;
  objectiveId?: unknown;
  objectiveName?: unknown;
  clientId?: unknown;
  clientName?: unknown;
  positionName?: unknown;
  /** Campos que deja `enrichEventShift` (o que ya trae el turno unificado). */
  eventoObjectiveId?: unknown;
  eventoObjectiveName?: unknown;
  eventoLat?: unknown;
  eventoLng?: unknown;
  eventoClientId?: unknown;
  eventoClientName?: unknown;
  eventoLugar?: unknown;
  [key: string]: unknown;
}

export interface EventoUbicacionDoc {
  tipo?: unknown;
  objectiveId?: unknown;
  objectiveNombre?: unknown;
  direccion?: unknown;
  latitud?: unknown;
  longitud?: unknown;
}

export interface EventoServicioDoc {
  id?: unknown;
  nombre?: unknown;
  ubicacion?: EventoUbicacionDoc | null;
}

/** Lo mínimo que el CC necesita del doc `eventos/{id}`. */
export interface EventoDocLite {
  id?: unknown;
  nombre?: unknown;
  clienteId?: unknown;
  clienteNombre?: unknown;
  servicios?: EventoServicioDoc[] | null;
  /** Legacy: evento sin `servicios[]` con la ubicación en la raíz. */
  ubicacion?: EventoUbicacionDoc | null;
  objectiveId?: unknown;
  objectiveNombre?: unknown;
}

/** Objetivo del catálogo (`clients.objetivos[]` aplanado) con geo. */
export interface ObjetivoGeoLite {
  id?: unknown;
  objectiveId?: unknown;
  name?: unknown;
  clientId?: unknown;
  clientName?: unknown;
  lat?: unknown;
  lng?: unknown;
}

export type EventoUbicacionSource = 'turno' | 'evento_objetivo' | 'evento_coords' | null;

export interface EventoUbicacion {
  lat: number | null;
  lng: number | null;
  objectiveId: string | null;
  objectiveName: string | null;
  /** Texto para mostrar: nombre del objetivo del evento o la dirección cargada. */
  lugar: string | null;
  source: EventoUbicacionSource;
}

const str = (v: unknown): string => String(v ?? '').trim();
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Solo turnos realmente de evento (EV). No alcanza con `eventoId` suelto en un M/T/N. */
export function isEventShift(shift: EventoCcShift | null | undefined): boolean {
  if (!shift) return false;
  return str(shift.code).toUpperCase() === 'EV' || str(shift.origin).toUpperCase() === 'EVENTO';
}

/** Clave del grupo: evento + servicio. Sin ids cae a los nombres (turnos viejos). */
export function eventGroupKey(shift: EventoCcShift): string {
  const eventoId = str(shift.eventoId);
  const servicioId = str(shift.servicioId);
  if (eventoId || servicioId) return `EV_${eventoId || 'sin_evento'}_${servicioId || 'sin_servicio'}`;
  const eventoNombre = str(shift.eventoNombre);
  const servicioNombre = str(shift.servicioNombre);
  return `EVNAME_${eventoNombre || 'evento'}_${servicioNombre || 'servicio'}`;
}

export function eventName(shift: EventoCcShift): string {
  return str(shift.eventoNombre) || 'Evento sin nombre';
}

/** Nombre del servicio del evento. En EV el `positionName` viejo puede ser el puesto SLA que quedó pegado. */
export function eventServicioLabel(shift: EventoCcShift): string {
  return str(shift.servicioNombre) || str(shift.positionName) || str(shift.eventoNombre) || 'Evento';
}

/** «Evento: {evento} · {servicio}». */
export function eventGroupLabel(shift: EventoCcShift): string {
  const evento = eventName(shift);
  const servicio = str(shift.servicioNombre);
  return servicio ? `Evento: ${evento} · ${servicio}` : `Evento: ${evento}`;
}

export function buildObjetivoGeoMap(objetivos: ReadonlyArray<ObjetivoGeoLite> | null | undefined): Map<string, ObjetivoGeoLite> {
  const map = new Map<string, ObjetivoGeoLite>();
  for (const o of objetivos || []) {
    const id = str(o?.id || o?.objectiveId);
    if (id && !map.has(id)) map.set(id, o);
  }
  return map;
}

export function buildEventosMap(eventos: ReadonlyArray<EventoDocLite> | null | undefined): Map<string, EventoDocLite> {
  const map = new Map<string, EventoDocLite>();
  for (const e of eventos || []) {
    const id = str(e?.id);
    if (id) map.set(id, e);
  }
  return map;
}

function ubicacionDesdeDoc(
  u: EventoUbicacionDoc | null | undefined,
  objetivos: ReadonlyMap<string, ObjetivoGeoLite>,
): EventoUbicacion | null {
  if (!u) return null;
  const objectiveId = str(u.objectiveId);
  if (objectiveId) {
    const obj = objetivos.get(objectiveId);
    const lat = num(obj?.lat);
    const lng = num(obj?.lng);
    const objectiveName = str(obj?.name) || str(u.objectiveNombre) || null;
    if (lat !== null && lng !== null) {
      return { lat, lng, objectiveId, objectiveName, lugar: objectiveName || str(u.direccion) || null, source: 'evento_objetivo' };
    }
    const lat2 = num(u.latitud);
    const lng2 = num(u.longitud);
    if (lat2 !== null && lng2 !== null) {
      return { lat: lat2, lng: lng2, objectiveId, objectiveName, lugar: objectiveName || str(u.direccion) || null, source: 'evento_coords' };
    }
    // Objetivo del evento sin geo: igual se conoce el lugar (sin marcador).
    return { lat: null, lng: null, objectiveId, objectiveName, lugar: objectiveName || str(u.direccion) || null, source: 'evento_objetivo' };
  }
  const lat = num(u.latitud);
  const lng = num(u.longitud);
  const direccion = str(u.direccion) || str(u.objectiveNombre) || null;
  if (lat !== null && lng !== null) {
    return { lat, lng, objectiveId: null, objectiveName: str(u.objectiveNombre) || null, lugar: direccion, source: 'evento_coords' };
  }
  if (direccion) return { lat: null, lng: null, objectiveId: null, objectiveName: null, lugar: direccion, source: null };
  return null;
}

/**
 * Ubicación del evento para un turno EV. Orden: doc del evento (servicio del turno, después
 * cualquier servicio con ubicación, después la raíz legacy) → campos explícitos del turno
 * (`eventoObjectiveId`, `eventoLat`/`eventoLng`). El `objectiveId` del turno solo se usa si el
 * evento lo señala como su objetivo: nunca se asume que es el lugar del evento.
 */
export function resolveEventoUbicacion(
  shift: EventoCcShift,
  eventos: ReadonlyMap<string, EventoDocLite>,
  objetivos: ReadonlyMap<string, ObjetivoGeoLite>,
): EventoUbicacion {
  const vacio: EventoUbicacion = { lat: null, lng: null, objectiveId: null, objectiveName: null, lugar: null, source: null };
  const evento = eventos.get(str(shift.eventoId));
  if (evento) {
    const servicios = Array.isArray(evento.servicios) ? evento.servicios : [];
    const servicioId = str(shift.servicioId);
    const propio = servicios.find((s) => servicioId && str(s?.id) === servicioId);
    const candidatos = [propio, ...servicios.filter((s) => s !== propio), { ubicacion: evento.ubicacion ?? (evento.objectiveId ? { objectiveId: evento.objectiveId, objectiveNombre: evento.objectiveNombre } : null) }];
    let parcial: EventoUbicacion | null = null;
    for (const c of candidatos) {
      const u = ubicacionDesdeDoc(c?.ubicacion ?? null, objetivos);
      if (!u) continue;
      if (u.lat !== null && u.lng !== null) return u;
      if (!parcial) parcial = u;
    }
    if (parcial) return parcial;
  }
  const explicitObjectiveId = str(shift.eventoObjectiveId);
  if (explicitObjectiveId) {
    const obj = objetivos.get(explicitObjectiveId);
    const lat = num(obj?.lat) ?? num(shift.eventoLat);
    const lng = num(obj?.lng) ?? num(shift.eventoLng);
    const objectiveName = str(obj?.name) || str(shift.eventoObjectiveName) || null;
    return { lat, lng, objectiveId: explicitObjectiveId, objectiveName, lugar: objectiveName || str(shift.eventoLugar) || null, source: 'turno' };
  }
  const lat = num(shift.eventoLat);
  const lng = num(shift.eventoLng);
  if (lat !== null && lng !== null) {
    const objectiveName = str(shift.eventoObjectiveName) || null;
    return { lat, lng, objectiveId: null, objectiveName, lugar: objectiveName || str(shift.eventoLugar) || null, source: 'turno' };
  }
  return vacio;
}

export interface EventoEnrichFields {
  eventoObjectiveId: string | null;
  eventoObjectiveName: string | null;
  eventoLat: number | null;
  eventoLng: number | null;
  eventoClientId: string | null;
  eventoClientName: string | null;
  eventoLugar: string | null;
  eventoUbicacionSource: EventoUbicacionSource;
}

/** Campos del evento que el monitor pega al turno EV (no toca `objectiveId`, que sigue siendo dato). */
export function eventoEnrichFields(
  shift: EventoCcShift,
  eventos: ReadonlyMap<string, EventoDocLite>,
  objetivos: ReadonlyMap<string, ObjetivoGeoLite>,
): EventoEnrichFields {
  const u = resolveEventoUbicacion(shift, eventos, objetivos);
  const evento = eventos.get(str(shift.eventoId));
  const objetivoEvento = u.objectiveId ? objetivos.get(u.objectiveId) : undefined;
  const eventoClientId = str(evento?.clienteId) || str(shift.eventoClientId) || str(objetivoEvento?.clientId) || null;
  const eventoClientName = str(evento?.clienteNombre) || str(shift.eventoClientName) || str(objetivoEvento?.clientName) || null;
  return {
    eventoObjectiveId: u.objectiveId,
    eventoObjectiveName: u.objectiveName,
    eventoLat: u.lat,
    eventoLng: u.lng,
    eventoClientId,
    eventoClientName,
    eventoLugar: u.lugar,
    eventoUbicacionSource: u.source,
  };
}

export function enrichEventShift<T extends EventoCcShift>(
  shift: T,
  eventos: ReadonlyMap<string, EventoDocLite>,
  objetivos: ReadonlyMap<string, ObjetivoGeoLite>,
): T {
  if (!isEventShift(shift)) return shift;
  return { ...shift, ...eventoEnrichFields(shift, eventos, objetivos) };
}

/** Cliente del evento (si se conoce) o el que trae el turno. */
export function eventClientName(shift: EventoCcShift): string {
  return str(shift.eventoClientName) || str(shift.clientName);
}

export function eventClientId(shift: EventoCcShift): string {
  return str(shift.eventoClientId) || str(shift.clientId);
}

/** Lugar del evento para mostrar junto al guardia («Plaza de la Música»). Sin dato, el nombre del evento. */
export function eventPlaceLabel(shift: EventoCcShift): string {
  return str(shift.eventoLugar) || str(shift.eventoObjectiveName) || eventName(shift);
}

/** Dónde está el guardia: para EV el lugar del evento, para el resto su objetivo. */
export function shiftPlaceLabel(shift: EventoCcShift): string {
  if (isEventShift(shift)) return eventPlaceLabel(shift);
  return str(shift.objectiveName) || '—';
}

export type EstadoGuardiaEvento = 'PRESENTE' | 'SIN_FICHAR' | 'TARDE' | 'AUSENTE' | 'RETENIDO' | 'VACANTE' | 'PLAN' | 'COMPLETADO';

const ESTADO_LABEL: Record<EstadoGuardiaEvento, string> = {
  PRESENTE: 'PRESENTE',
  SIN_FICHAR: 'SIN FICHAR',
  TARDE: 'TARDE',
  AUSENTE: 'AUSENTE',
  RETENIDO: 'RETENIDO',
  VACANTE: 'VACANTE',
  PLAN: 'PLAN',
  COMPLETADO: 'CERRADO',
};

const ESTADO_COLOR: Record<EstadoGuardiaEvento, string> = {
  PRESENTE: '#059669',
  SIN_FICHAR: '#4f46e5',
  TARDE: '#d97706',
  AUSENTE: '#dc2626',
  RETENIDO: '#ea580c',
  VACANTE: '#e11d48',
  PLAN: '#94a3b8',
  COMPLETADO: '#64748b',
};

type ShiftEstadoFlags = {
  isPresent?: boolean;
  isAbsent?: boolean;
  isPotentialAbsence?: boolean;
  isProvisionalLateAbsence?: boolean;
  isRetention?: boolean;
  isPendingRetention?: boolean;
  isCompleted?: boolean;
  isUnassigned?: boolean;
  isLateNotified?: boolean;
  isLateUnnotified?: boolean;
  isFuture?: boolean;
  isImminent?: boolean;
  shiftDateObj?: unknown;
};

function startMs(shift: ShiftEstadoFlags): number {
  const d = shift.shiftDateObj as { seconds?: number; getTime?: () => number } | null | undefined;
  if (!d) return NaN;
  if (typeof d.getTime === 'function') return d.getTime();
  if (typeof d.seconds === 'number') return d.seconds * 1000;
  return NaN;
}

/**
 * Estado del guardia dentro del evento (popup del mapa y tarjeta del evento):
 * presente, sin fichar (en ventana T−15…T+5), tarde, ausente.
 */
export function estadoGuardiaEvento(shift: ShiftEstadoFlags, now: Date | number = Date.now()): { estado: EstadoGuardiaEvento; label: string; color: string } {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const diffMin = (nowMs - startMs(shift)) / 60000;
  let estado: EstadoGuardiaEvento;
  if (shift.isUnassigned) estado = 'VACANTE';
  else if (shift.isCompleted && !shift.isRetention) estado = 'COMPLETADO';
  else if (shift.isRetention || shift.isPendingRetention) estado = 'RETENIDO';
  else if (shift.isPresent) estado = 'PRESENTE';
  else if (shift.isAbsent || shift.isPotentialAbsence) estado = 'AUSENTE';
  else if (shift.isLateNotified || shift.isLateUnnotified || (Number.isFinite(diffMin) && diffMin > 5)) estado = 'TARDE';
  else if (Number.isFinite(diffMin) && diffMin >= -15) estado = 'SIN_FICHAR';
  else estado = 'PLAN';
  return { estado, label: ESTADO_LABEL[estado], color: ESTADO_COLOR[estado] };
}

export interface EventoGrupo<T extends EventoCcShift = EventoCcShift> {
  /** Clave estable (`EV_{eventoId}_{servicioId}`), sirve de id de tarjeta y de marcador. */
  eventKey: string;
  label: string;
  eventoId: string;
  eventoNombre: string;
  servicioId: string;
  servicioNombre: string;
  client: string;
  clientId: string;
  /** Lugar del evento (objetivo del evento o dirección). Null si no se pudo resolver. */
  lugar: string | null;
  objectiveId: string | null;
  lat: number | null;
  lng: number | null;
  active: number;
  retention: number;
  absent: number;
  /** Ausencias sin cobertura (lo escribe `addShiftToOpsBucket`). */
  absentSinCubrir?: number;
  vacant: number;
  plan: number;
  late: number;
  total: number;
  criticalShift: T | null;
  shifts: T[];
}

/**
 * Agrupa los turnos EV por evento · servicio con los mismos contadores que la tarjeta de objetivo
 * (`objectivesWithAlerts`). Los que no son EV se ignoran.
 */
export function buildEventoGroups<T extends EventoCcShift & ShiftEstadoFlags & { isFranco?: boolean }>(
  shifts: ReadonlyArray<T>,
  now: Date = new Date(),
): EventoGrupo<T>[] {
  const map = new Map<string, EventoGrupo<T>>();
  for (const s of shifts) {
    if (!isEventShift(s) || s.isFranco) continue;
    const key = eventGroupKey(s);
    let g = map.get(key);
    if (!g) {
      g = {
        eventKey: key,
        label: eventGroupLabel(s),
        eventoId: str(s.eventoId),
        eventoNombre: eventName(s),
        servicioId: str(s.servicioId),
        servicioNombre: str(s.servicioNombre),
        client: eventClientName(s),
        clientId: eventClientId(s),
        lugar: str(s.eventoLugar) || str(s.eventoObjectiveName) || null,
        objectiveId: str(s.eventoObjectiveId) || null,
        lat: num(s.eventoLat),
        lng: num(s.eventoLng),
        active: 0, retention: 0, absent: 0, vacant: 0, plan: 0, late: 0, total: 0,
        criticalShift: null,
        shifts: [],
      };
      map.set(key, g);
    } else {
      if (!g.lugar) g.lugar = str(s.eventoLugar) || str(s.eventoObjectiveName) || null;
      if (g.lat === null || g.lng === null) { g.lat = num(s.eventoLat); g.lng = num(s.eventoLng); }
      if (!g.client) g.client = eventClientName(s);
      if (!g.clientId) g.clientId = eventClientId(s);
    }
    g.total++;
    g.shifts.push(s);
    const vacantBefore = g.vacant;
    addShiftToOpsBucket(g, s as never, now);
    if (g.vacant > vacantBefore && g.vacant === 1) g.criticalShift = s;
    else if (!g.criticalShift && shiftMatchesOpsViewTab(s as never, 'AUSENTES', now)) g.criticalShift = s;
    if (!s.isPresent && !s.isAbsent && !s.isPotentialAbsence && !s.isUnassigned && !s.isCompleted && estadoGuardiaEvento(s, now).estado === 'TARDE') g.late++;
  }
  return Array.from(map.values()).sort((a, b) => {
    const scoreA = a.absent * 3 + a.vacant * 2 + a.retention;
    const scoreB = b.absent * 3 + b.vacant * 2 + b.retention;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.label.localeCompare(b.label, 'es');
  });
}

/** Separa turnos regulares de los de evento (misma lista, un solo recorrido). */
export function splitEventShifts<T extends EventoCcShift>(shifts: ReadonlyArray<T>): { regular: T[]; eventos: T[] } {
  const regular: T[] = [];
  const eventos: T[] = [];
  for (const s of shifts) (isEventShift(s) ? eventos : regular).push(s);
  return { regular, eventos };
}
