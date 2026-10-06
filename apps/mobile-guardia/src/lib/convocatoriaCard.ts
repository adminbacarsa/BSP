/**
 * Modelo único de la tarjeta de convocatoria (Hoy y Alertas).
 *
 * Cobertura (RET/REF/ESC/FT/EXT/ADV/eventual), evento, ¿Venís? (llegada tarde /
 * aviso al entrante) y aviso de retenido comparten la misma tarjeta: título claro,
 * objetivo y cliente reales (nunca el literal «Objetivo»), puesto, fecha, horario en
 * 24 h («16:00–17:00»), tipo en palabras, mensaje con el nombre y cuenta regresiva.
 */
import type { Evento, FirestoreTimestampLike, ObjectiveLocation, Shift, SolicitudEvento } from '@cosp/portal-types';
import type { ConvocatoriaCobertura } from './convocatoriasCobertura';
import { isAvisoEntrante, isRetencionAviso } from './avisosCc';

/* Helpers de fecha locales (mismo criterio que portal-core `toDate` / `formatTimeAr`):
 * el módulo se testea en Node sin cargar el índice de portal-core. */
function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val === 'object') {
    const o = val as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof o.toDate === 'function') return o.toDate();
    const seconds = o.seconds ?? o._seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000);
    return null;
  }
  if (typeof val === 'number' || typeof val === 'string') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatTimeAr(d: Date): string {
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
}

export type ConvocatoriaCardKind = 'COBERTURA' | 'EVENTO' | 'VENIS' | 'RETENCION' | 'DISPONIBILIDAD';

export type ConvocatoriaCardActions = 'ACCEPT_REJECT' | 'VENIS' | 'NONE';

export type ConvocatoriaCardModel = {
  id: string;
  kind: ConvocatoriaCardKind;
  /** Rótulo chico arriba: «Cobertura», «Evento», «Llegada tarde», «Retención». */
  kicker: string;
  /** Tipo en palabras: «Franco trabajado (FT)», «Extensión», «Evento»… */
  tipo: string | null;
  title: string;
  /** Mensaje con el nombre del guardia. */
  message: string;
  cliente: string | null;
  objetivo: string | null;
  puesto: string | null;
  /** dd/MM/yyyy */
  fecha: string | null;
  /** «16:00–17:00» (24 h). */
  horario: string | null;
  codigo: string | null;
  timeoutAtMs: number | null;
  actions: ConvocatoriaCardActions;
  /** Si vienen, pisan «Aceptar» / «Rechazar» (consulta de disponibilidad). */
  acceptLabel?: string | null;
  rejectLabel?: string | null;
  /** Líneas del bloque (un día por renglón) en la consulta de disponibilidad. */
  detalle?: string[] | null;
};

const TZ = 'America/Argentina/Buenos_Aires';
const PLACEHOLDERS = new Set(['', 'objetivo', 'tu puesto', 'el puesto', 'puesto', 'undefined', 'null', '-', '—']);

function clean(v: unknown): string {
  const t = String(v ?? '').trim();
  return PLACEHOLDERS.has(t.toLowerCase()) ? '' : t;
}

function first(...vals: unknown[]): string | null {
  for (const v of vals) {
    const t = clean(v);
    if (t) return t;
  }
  return null;
}

function toMs(val: unknown): number | null {
  const d = toDate(val as FirestoreTimestampLike);
  if (!d) return null;
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function capitalize(raw: string): string {
  const lower = raw.toLocaleLowerCase('es-AR');
  return lower.charAt(0).toLocaleUpperCase('es-AR') + lower.slice(1);
}

/** Mayúscula en la primera letra (salta «¿» o «¡»), sin tocar el resto. */
function sentenceStart(raw: string): string {
  const idx = raw.search(/\p{L}/u);
  if (idx < 0) return raw;
  return raw.slice(0, idx) + raw.charAt(idx).toLocaleUpperCase('es-AR') + raw.slice(idx + 1);
}

/** Primer nombre: firstName, o lo que sigue a la coma en «APELLIDO, Nombre», o el primer token. */
export function convocatoriaFirstName(input: {
  firstName?: string | null;
  fullName?: string | null;
}): string {
  const direct = clean(input.firstName).split(/\s+/)[0] || '';
  if (direct) return capitalize(direct);
  const full = clean(input.fullName);
  if (!full) return '';
  const comma = full.indexOf(',');
  const given = comma >= 0 ? full.slice(comma + 1) : full;
  const token = given.trim().split(/\s+/)[0] || '';
  return token ? capitalize(token) : '';
}

/** Tipo de cobertura en palabras. */
export function convocatoriaTipoLabel(type: string | undefined | null): string {
  const t = String(type || '').trim().toUpperCase();
  switch (t) {
    case 'FT':
      return 'Franco trabajado (FT)';
    case 'EXTEND':
    case 'EXT':
      return 'Extensión';
    case 'ADVANCE':
    case 'ADV':
      return 'Adelanto';
    case 'RET':
      return 'Retén';
    case 'REF':
      return 'Refuerzo';
    case 'ESC':
      return 'Escuela';
    case 'EVENTUAL':
      return 'Eventual';
    case 'EVENTO':
      return 'Evento';
    case 'LLEGADA_TARDE':
      return 'Llegada tarde';
    case 'VOLANTE':
    case 'SIN_TURNO':
    case 'SIN_TURNO_CON_EXP':
      return 'Cobertura';
    default:
      return t ? `Cobertura (${t})` : 'Cobertura';
  }
}

/** Horario 24 h: «16:00–17:00»; sin fin «16:00». */
export function formatHorario24(start: unknown, end?: unknown): string | null {
  const s = toDate(start as FirestoreTimestampLike);
  if (!s) return null;
  const hi = formatTimeAr(s);
  const e = toDate(end as FirestoreTimestampLike);
  if (!e) return hi;
  return `${hi}–${formatTimeAr(e)}`;
}

/** dd/MM/yyyy en hora AR. */
export function formatFechaAr(val: unknown): string | null {
  const d = toDate(val as FirestoreTimestampLike);
  if (!d) return null;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
}

/** «HH:MM» de un string «HH:MM» o «H:MM»; vacío si no parsea. */
function hhmm(raw: unknown): string {
  const m = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** dd/MM/yyyy de «yyyy-MM-dd». */
function fechaDeYmd(raw: unknown): string | null {
  const m = String(raw ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export type LugarResuelto = { cliente: string | null; objetivo: string | null; puesto: string | null };

type LugarFuente = {
  shiftId?: string | null;
  objectiveId?: string | null;
  objectiveName?: string | null;
  positionName?: string | null;
  clientName?: string | null;
};

/**
 * Objetivo, cliente y puesto reales. Si la convocatoria no los trae, se buscan en el
 * turno (`shiftId`) y en el mapa de objetivos (`objectiveId` o nombre). Nunca devuelve
 * el literal «Objetivo».
 */
export function resolveLugarConvocatoria(
  src: LugarFuente,
  shifts: Shift[] = [],
  objectivesMap: Record<string, ObjectiveLocation> = {},
): LugarResuelto {
  const shift = src.shiftId ? shifts.find((s) => s.id === src.shiftId) : undefined;
  const objectiveId = first(src.objectiveId, shift?.objectiveId);
  const byId = objectiveId ? objectivesMap[objectiveId] : undefined;
  const nameHint = first(src.objectiveName, shift?.objectiveName);
  const byName = nameHint ? objectivesMap[nameHint] : undefined;
  const loc = byId ?? byName;
  return {
    objetivo: first(src.objectiveName, shift?.objectiveName, loc?.name),
    cliente: first(src.clientName, shift?.clientName, loc?.clientName),
    puesto: first(src.positionName, shift?.positionName),
  };
}

/** Línea «Cliente · Objetivo · Puesto» con lo que haya. */
export function lugarLinea(l: LugarResuelto): string {
  return [l.cliente, l.objetivo, l.puesto].filter(Boolean).join(' · ');
}

function lugarParaMensaje(l: LugarResuelto): string {
  if (l.puesto && l.objetivo) return `${l.puesto} en ${l.objetivo}`;
  return l.puesto || l.objetivo || l.cliente || 'el puesto';
}

export type CoberturaCardInput = {
  conv: ConvocatoriaCobertura;
  firstName?: string | null;
  shifts?: Shift[];
  objectivesMap?: Record<string, ObjectiveLocation>;
  /** Texto del servidor (bandeja). Para ¿Venís? se respeta; para cobertura se arma acá. */
  body?: string | null;
};

/** Cobertura RET/REF/ESC/FT/EXT/ADV/eventual: Aceptar / Rechazar. */
export function buildCoberturaCardModel(input: CoberturaCardInput): ConvocatoriaCardModel {
  const { conv } = input;
  const lugar = resolveLugarConvocatoria(conv, input.shifts, input.objectivesMap);
  const horario = formatHorario24(conv.startTime, conv.endTime);
  const name = convocatoriaFirstName({ firstName: input.firstName, fullName: conv.candidateEmployeeName });
  const rango = horario ? ` de ${horario.replace('–', ' a ')}` : '';
  const base = `¿nos das una mano? Necesitamos cubrir ${lugarParaMensaje(lugar)}${rango}.`;
  return {
    id: conv.id,
    kind: 'COBERTURA',
    kicker: 'Cobertura',
    tipo: convocatoriaTipoLabel(conv.type),
    title: '¿Nos das una mano?',
    message: name ? `${name}, ${base}` : sentenceStart(base),
    cliente: lugar.cliente,
    objetivo: lugar.objetivo,
    puesto: lugar.puesto,
    fecha: formatFechaAr(conv.startTime),
    horario,
    codigo: first(conv.shiftCode)?.toUpperCase() ?? null,
    timeoutAtMs: toMs(conv.timeoutAt),
    actions: 'ACCEPT_REJECT',
  };
}

/** ¿Venís? (LLEGADA_TARDE o aviso del CC al entrante): 10 / 15 / 30 min o «Tengo un problema». */
export function buildVenisCardModel(input: CoberturaCardInput): ConvocatoriaCardModel {
  const { conv } = input;
  const lugar = resolveLugarConvocatoria(conv, input.shifts, input.objectivesMap);
  const horario = formatHorario24(conv.startTime, conv.endTime);
  const name = convocatoriaFirstName({ firstName: input.firstName, fullName: conv.candidateEmployeeName });
  const body = clean(input.body);
  const donde = lugarLinea({ ...lugar, cliente: null });
  const inicio = formatHorario24(conv.startTime);
  const propio = inicio
    ? `Tu turno empezó a las ${inicio}${donde ? ` en ${donde}` : ''}. Contanos si llegás en 10, 15 o 30 min.`
    : `Te esperan en ${donde || 'el puesto'}. Contanos si llegás en 10, 15 o 30 min.`;
  return {
    id: conv.id,
    kind: 'VENIS',
    kicker: 'Llegada tarde',
    tipo: null,
    title: '¿Venís?',
    message: body || (name ? `${name}, ¿venís? ${propio}` : `¿Venís? ${propio}`),
    cliente: lugar.cliente,
    objetivo: lugar.objetivo,
    puesto: lugar.puesto,
    fecha: formatFechaAr(conv.startTime),
    horario,
    codigo: first(conv.shiftCode)?.toUpperCase() ?? null,
    timeoutAtMs: toMs(conv.timeoutAt),
    actions: 'VENIS',
  };
}

export type EventoCardInput = {
  sol: SolicitudEvento;
  firstName?: string | null;
  eventosMap?: Record<string, Evento>;
};

/** Convocatoria a un evento: Aceptar / Rechazar. */
export function buildEventoCardModel(input: EventoCardInput): ConvocatoriaCardModel {
  const { sol } = input;
  const evento = sol.eventoId ? input.eventosMap?.[sol.eventoId] : undefined;
  const servicio = evento?.servicios?.find((s) => s.id === sol.servicioId);
  const name = convocatoriaFirstName({ firstName: input.firstName, fullName: sol.empleadoNombre });
  const hi = hhmm(sol.jornada?.horaInicio ?? servicio?.horaInicio ?? evento?.horaInicio);
  const hf = hhmm(sol.jornada?.horaFin ?? servicio?.horaFin ?? evento?.horaFin);
  const horario = hi ? (hf ? `${hi}–${hf}` : hi) : null;
  const fecha = fechaDeYmd(sol.jornada?.fecha ?? sol.servicioFecha ?? servicio?.fecha ?? evento?.fecha);
  const objetivo = first(servicio?.ubicacion?.objectiveNombre, servicio?.ubicacion?.direccion, sol.eventoNombre);
  const cuando = [fecha ? `el ${fecha}` : '', horario ? `de ${horario.replace('–', ' a ')}` : ''].filter(Boolean).join(' ');
  const base = `te convocamos al evento ${first(sol.eventoNombre) || ''}${sol.servicioNombre ? ` (${sol.servicioNombre})` : ''}${cuando ? ` ${cuando}` : ''}.`;
  return {
    id: String(sol.id || `${sol.eventoId}_${sol.servicioId}`),
    kind: 'EVENTO',
    kicker: 'Evento',
    tipo: 'Evento',
    title: first(sol.eventoNombre) || 'Convocatoria a evento',
    message: name ? `${name}, ${base}` : sentenceStart(base),
    cliente: first(evento?.clienteNombre),
    objetivo,
    puesto: first(sol.servicioNombre),
    fecha,
    horario,
    codigo: 'EV',
    timeoutAtMs: toMs(sol.venceAt),
    actions: 'ACCEPT_REJECT',
  };
}

export type RetencionCardInput = {
  aviso: {
    id: string;
    title?: string | null;
    body?: string | null;
    objectiveName?: string | null;
    clientName?: string | null;
    positionName?: string | null;
    shiftId?: string | null;
    objectiveId?: string | null;
    startTime?: unknown;
    endTime?: unknown;
    shiftCode?: string | null;
  };
  shifts?: Shift[];
  objectivesMap?: Record<string, ObjectiveLocation>;
};

/** RETENCION_AVISO: el CC avisa que seguís retenido. Informativa. */
export function buildRetencionCardModel(input: RetencionCardInput): ConvocatoriaCardModel {
  const { aviso } = input;
  const lugar = resolveLugarConvocatoria(aviso, input.shifts, input.objectivesMap);
  const shift = aviso.shiftId ? input.shifts?.find((s) => s.id === aviso.shiftId) : undefined;
  const startTime = aviso.startTime ?? shift?.startTime;
  const endTime = aviso.endTime ?? shift?.endTime;
  return {
    id: aviso.id,
    kind: 'RETENCION',
    kicker: 'Retención',
    tipo: 'Retén',
    title: first(aviso.title) || 'Seguís retenido',
    message: clean(aviso.body) || 'Operaciones te avisa que seguís retenido hasta que llegue el relevo.',
    cliente: lugar.cliente,
    objetivo: lugar.objetivo,
    puesto: lugar.puesto,
    fecha: formatFechaAr(startTime),
    horario: formatHorario24(startTime, endTime),
    codigo: first(aviso.shiftCode, shift?.code)?.toUpperCase() ?? null,
    timeoutAtMs: null,
    actions: 'NONE',
  };
}

export type InboxCardSource = {
  id: string;
  type?: string;
  title?: string;
  body?: string;
  shiftId?: string;
  objectiveId?: string;
  objectiveName?: string;
  positionName?: string;
  clientName?: string;
  clientId?: string;
  shiftCode?: string;
  startTime?: unknown;
  endTime?: unknown;
  convocatoriaId?: string;
  timeoutAt?: unknown;
  eventoId?: string;
  servicioId?: string;
  solicitudId?: string;
  jornadas?: { fecha?: string; code?: string; horaInicio?: string; horaFin?: string }[] | null;
};

/** Lo que la bandeja conoce del doc `convocatorias_cobertura` (timestamps sin tipar). */
export type InboxConvVista = {
  id?: string;
  type?: string;
  status?: string;
  shiftId?: string;
  objectiveId?: string;
  objectiveName?: string;
  positionName?: string;
  clientName?: string;
  shiftCode?: string;
  startTime?: unknown;
  endTime?: unknown;
  timeoutAt?: unknown;
  candidateEmployeeName?: string;
};

export type InboxCardInput = {
  item: InboxCardSource;
  conv?: InboxConvVista | null;
  firstName?: string | null;
  shifts?: Shift[];
  objectivesMap?: Record<string, ObjectiveLocation>;
};

/** ¿La alerta de la bandeja se muestra con la tarjeta de convocatoria? */
export function inboxItemIsConvocatoria(item: Pick<InboxCardSource, 'type'>): boolean {
  const t = String(item.type || '').trim().toUpperCase();
  return (
    t === 'CONVOCATORIA_COBERTURA' ||
    t === 'RETENCION' ||
    t === 'ADELANTO' ||
    t === 'LLEGADA_TARDE' ||
    t === 'RETENCION_AVISO' ||
    t === 'CONVOCATORIA_EVENTO' ||
    t === 'CONSULTA_DISPONIBILIDAD'
  );
}

export type JornadaDisponibilidadCard = { fecha?: string; code?: string; horaInicio?: string; horaFin?: string };

const MESES_CARD = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function ddmmCard(fecha: string): string {
  const [, m, d] = String(fecha || '').split('-');
  return d && m ? `${d}/${m}` : String(fecha || '');
}

/** Pregunta del bloque para la tarjeta. Un solo día queda en el texto que guardó el servidor. */
export function armarPreguntaDisponibilidad(input: {
  cliente?: string | null;
  objetivo?: string | null;
  puesto?: string | null;
  jornadas?: JornadaDisponibilidadCard[] | null;
}): { pregunta: string; detalle: string[]; contratos: string | null } | null {
  const list = (input.jornadas || [])
    .filter((j) => String(j?.fecha || '').length >= 10)
    .slice()
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  if (list.length <= 1) return null;
  const lugar = [input.cliente, input.objetivo, input.puesto].map((s) => String(s || '').trim()).filter(Boolean).join(' · ');
  const detalle = list.map((j) => {
    const code = String(j.code || '').trim();
    const horario = `${String(j.horaInicio || '').slice(0, 5)}–${String(j.horaFin || '').slice(0, 5)}`;
    return `${ddmmCard(String(j.fecha))} · ${code ? `${code} ` : ''}${horario}`;
  });
  const meses = [...new Set(list.map((j) => String(j.fecha).slice(0, 7)))].sort();
  const contratos = meses.length < 2 ? null : (() => {
    const nombres = meses.map((mes) => {
      const [y, m] = mes.split('-');
      return `${MESES_CARD[Number(m) - 1] || mes} ${y}`;
    });
    return meses.length === 2
      ? `Son dos contratos (${nombres[0]} y ${nombres[1]}).`
      : `Son ${meses.length} contratos (${nombres.join(', ')}).`;
  })();
  const pregunta = `¿Podés cubrir ${list.length} días (${ddmmCard(String(list[0].fecha))} → ${ddmmCard(String(list[list.length - 1].fecha))})${lugar ? ` en ${lugar}` : ''}?`;
  return { pregunta, detalle, contratos };
}

export function buildDisponibilidadCardModel(input: {
  id: string;
  message: string;
  cliente?: string | null;
  objetivo?: string | null;
  puesto?: string | null;
  fecha?: string | null;
  horario?: string | null;
  timeoutAtMs?: number | null;
  detalle?: string[] | null;
  title?: string | null;
}): ConvocatoriaCardModel {
  return {
    id: input.id,
    kind: 'DISPONIBILIDAD',
    kicker: 'Disponibilidad',
    tipo: 'Consulta',
    title: input.title || '¿Estás disponible?',
    message: input.message,
    cliente: input.cliente || null,
    objetivo: input.objetivo || null,
    puesto: input.puesto || null,
    fecha: input.fecha || null,
    horario: input.horario || null,
    codigo: null,
    timeoutAtMs: input.timeoutAtMs ?? null,
    actions: 'ACCEPT_REJECT',
    acceptLabel: 'Sí, puedo',
    rejectLabel: 'No puedo',
    detalle: input.detalle || null,
  };
}

/**
 * Tarjeta a partir de una alerta de la bandeja (Alertas). Los datos del doc de la
 * convocatoria (`conv`) completan lo que la notificación no trae.
 */
export function buildInboxCardModel(input: InboxCardInput): ConvocatoriaCardModel | null {
  const { item, conv } = input;
  const type = String(item.type || '').trim().toUpperCase();
  if (!inboxItemIsConvocatoria(item)) return null;

  const merged: ConvocatoriaCobertura = {
    id: String(item.convocatoriaId || conv?.id || item.id),
    shiftId: first(item.shiftId, conv?.shiftId) ?? undefined,
    objectiveId: first(item.objectiveId, conv?.objectiveId) ?? undefined,
    objectiveName: first(item.objectiveName, conv?.objectiveName) ?? undefined,
    positionName: first(item.positionName, conv?.positionName) ?? undefined,
    clientName: first(item.clientName, conv?.clientName) ?? undefined,
    shiftCode: first(item.shiftCode, conv?.shiftCode) ?? undefined,
    startTime: (item.startTime ?? conv?.startTime) as FirestoreTimestampLike | undefined,
    endTime: (item.endTime ?? conv?.endTime) as FirestoreTimestampLike | undefined,
    timeoutAt: (conv?.timeoutAt ?? item.timeoutAt) as FirestoreTimestampLike | undefined,
    type: String(conv?.type || (type === 'LLEGADA_TARDE' ? 'LLEGADA_TARDE' : type === 'RETENCION' ? 'RET' : type === 'ADELANTO' ? 'ADV' : '')),
    status: String(conv?.status || 'PENDING'),
    candidateEmployeeName: conv?.candidateEmployeeName,
  };
  const common = { conv: merged, firstName: input.firstName, shifts: input.shifts, objectivesMap: input.objectivesMap };

  if (isRetencionAviso(type)) {
    return { ...buildRetencionCardModel({ aviso: { ...item, id: item.id }, shifts: input.shifts, objectivesMap: input.objectivesMap }), id: item.id };
  }
  if (type === 'CONSULTA_DISPONIBILIDAD') {
    const bloque = armarPreguntaDisponibilidad({
      cliente: first(item.clientName),
      objetivo: first(item.objectiveName),
      puesto: first(item.positionName),
      jornadas: item.jornadas,
    });
    return buildDisponibilidadCardModel({
      id: item.id,
      title: bloque ? '¿Podés cubrir?' : undefined,
      message: bloque
        ? `${bloque.pregunta}${bloque.contratos ? ` ${bloque.contratos}` : ''}`
        : (clean(item.body) || '¿Estás disponible?'),
      detalle: bloque?.detalle,
      cliente: first(item.clientName),
      objetivo: first(item.objectiveName),
      puesto: first(item.positionName),
      timeoutAtMs: toMs(item.timeoutAt),
    });
  }
  if (type === 'CONVOCATORIA_EVENTO') {
    const lugar = resolveLugarConvocatoria(merged, input.shifts, input.objectivesMap);
    return {
      id: item.id,
      kind: 'EVENTO',
      kicker: 'Evento',
      tipo: 'Evento',
      title: first(item.title) || 'Convocatoria a evento',
      message: clean(item.body) || 'Te convocamos a un evento. Respondé desde Eventos.',
      cliente: lugar.cliente,
      objetivo: lugar.objetivo,
      puesto: lugar.puesto,
      fecha: formatFechaAr(merged.startTime),
      horario: formatHorario24(merged.startTime, merged.endTime),
      codigo: 'EV',
      timeoutAtMs: toMs(merged.timeoutAt),
      actions: 'NONE',
    };
  }
  if (isAvisoEntrante({ type, title: item.title, convType: conv?.type })) {
    return { ...buildVenisCardModel({ ...common, body: item.body }), id: item.id };
  }
  return { ...buildCoberturaCardModel(common), id: item.id };
}

/** Cuenta regresiva: «59 s», «2:30», o aviso de plazo vencido (todavía se puede responder). */
export function remainingLabel(timeoutAtMs: number | null | undefined, nowMs: number): string {
  if (!timeoutAtMs || !Number.isFinite(timeoutAtMs)) return '';
  const sec = Math.max(0, Math.floor((timeoutAtMs - nowMs) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0 && s <= 0) return 'Tiempo agotado (aún podés responder)';
  if (m <= 0) return `${s}s restantes`;
  return `${m}:${String(s).padStart(2, '0')} restantes`;
}

export const CONVOCATORIA_ACCEPT_LABEL = 'Aceptar';
export const CONVOCATORIA_REJECT_LABEL = 'Rechazar';
export const LLEGADA_TARDE_ETA_OPTIONS = [10, 15, 30] as const;
export type LlegadaTardeEtaMinutes = (typeof LLEGADA_TARDE_ETA_OPTIONS)[number];
