/**
 * Supervisión en el celular: módulo propio del supervisor que recorre objetivos.
 * Lógica pura (sin Firestore): filas por objetivo con estado resumido del momento,
 * link «Cómo llegar», última visita y alertas propias (sin visita en N días, novedades
 * de supervisión). Sin acciones sobre turnos.
 */
import type { MovilAlerta } from './modulos';
import { arYmd } from './menuLayout';

/** Objetivos sin visita hace más de estos días pasan a alerta. */
export const SUPERVISION_DIAS_SIN_VISITA = 7;
/** Ventana de visitas que se leen para «última visita» (30 días). */
export const SUPERVISION_VISITAS_VENTANA_MS = 30 * 24 * 60 * 60 * 1000;
/** Tipo de novedad que escribe «Novedad de la visita». */
export const SUPERVISION_NOVEDAD_TYPE = 'SUPERVISION_NOVEDAD';
export const SUPERVISION_SOURCE = 'SUPERVISION';

export interface SupervisionObjetivo {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface SupervisionTurnoLite {
  objectiveId?: string | null;
  startTime?: number | null;
  endTime?: number | null;
  isPresent?: boolean;
  isAbsent?: boolean;
  isCompleted?: boolean;
  isRetention?: boolean;
  realEndTime?: unknown;
  draft?: boolean;
  isFranco?: boolean;
  isVirtual?: boolean;
}

export interface SupervisionVisitaLite {
  id?: string;
  objectiveId: string;
  createdAtMs: number | null;
  supervisorNombre?: string;
  resultado?: string;
}

export type SupervisionTono = 'emerald' | 'rose' | 'orange' | 'slate';

export interface SupervisionResumen {
  activos: number;
  ausentes: number;
  retenidos: number;
}

export interface SupervisionRow extends SupervisionObjetivo {
  resumen: SupervisionResumen;
  tono: SupervisionTono;
  /** «2 activos · 1 ausente» o «Sin guardias ahora». */
  estadoTexto: string;
  ultimaVisita: SupervisionVisitaLite | null;
  /** «Hoy 10:20 · Pérez», «Hace 3 días · Pérez», «Sin visitas». */
  visitaTexto: string;
  diasSinVisita: number | null;
  mapsUrl: string | null;
}

const plural = (count: number, uno: string, varios: string): string => `${count} ${count === 1 ? uno : varios}`;

/** Estado del objetivo en este momento, con los mismos criterios del menú/CC resumido. */
export function resumenObjetivoSupervision(turnos: readonly SupervisionTurnoLite[], nowMs: number): SupervisionResumen {
  let activos = 0;
  let ausentes = 0;
  let retenidos = 0;
  for (const t of turnos) {
    if (t.draft || t.isFranco || t.isVirtual) continue;
    const start = Number(t.startTime || 0);
    const end = Number(t.endTime || 0);
    const enCurso = t.isPresent && !t.isCompleted && !t.realEndTime && !t.isAbsent;
    if (enCurso) {
      activos += 1;
      if (t.isRetention) retenidos += 1;
    }
    // Ausente que todavía cuenta: la franja no terminó (o terminó hace menos de 1 h).
    if (t.isAbsent && start > 0 && (end === 0 || end + 60 * 60 * 1000 >= nowMs) && arYmd(start) === arYmd(nowMs)) ausentes += 1;
  }
  return { activos, ausentes, retenidos };
}

export function tonoSupervision(r: SupervisionResumen): SupervisionTono {
  if (r.ausentes > 0) return 'rose';
  if (r.retenidos > 0) return 'orange';
  if (r.activos > 0) return 'emerald';
  return 'slate';
}

export function textoResumen(r: SupervisionResumen): string {
  const partes: string[] = [];
  if (r.activos > 0) partes.push(plural(r.activos, 'activo', 'activos'));
  if (r.ausentes > 0) partes.push(plural(r.ausentes, 'ausente', 'ausentes'));
  if (r.retenidos > 0) partes.push(plural(r.retenidos, 'retenido', 'retenidos'));
  return partes.length ? partes.join(' · ') : 'Sin guardias ahora';
}

/** Link a Google Maps: coordenadas si hay, si no la dirección; sin ninguna de las dos no hay botón. */
export function mapsUrl(obj: Pick<SupervisionObjetivo, 'address' | 'lat' | 'lng'>): string | null {
  const lat = Number(obj.lat);
  const lng = Number(obj.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  const address = String(obj.address || '').trim();
  if (address) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  return null;
}

export function diasDesde(ms: number, nowMs: number): number {
  const a = arYmd(ms);
  const b = arYmd(nowMs);
  const toUtc = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  return Math.max(0, Math.round((toUtc(b) - toUtc(a)) / 86_400_000));
}

function horaAr(ms: number): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Cordoba', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}

function fechaCortaAr(ms: number): string {
  const ymd = arYmd(ms);
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

export function textoVisita(visita: SupervisionVisitaLite | null, nowMs: number): string {
  if (!visita || !visita.createdAtMs) return 'Sin visitas';
  const dias = diasDesde(visita.createdAtMs, nowMs);
  const quien = visita.supervisorNombre ? ` · ${visita.supervisorNombre}` : '';
  if (dias === 0) return `Hoy ${horaAr(visita.createdAtMs)}${quien}`;
  if (dias === 1) return `Ayer ${horaAr(visita.createdAtMs)}${quien}`;
  if (dias < 30) return `Hace ${dias} días${quien}`;
  return `${fechaCortaAr(visita.createdAtMs)}${quien}`;
}

/** Última visita (la más reciente) por objetivo. */
export function ultimaVisitaPorObjetivo(visitas: readonly SupervisionVisitaLite[]): Map<string, SupervisionVisitaLite> {
  const out = new Map<string, SupervisionVisitaLite>();
  for (const v of visitas) {
    if (!v.objectiveId || !v.createdAtMs) continue;
    const prev = out.get(v.objectiveId);
    if (!prev || (prev.createdAtMs || 0) < v.createdAtMs) out.set(v.objectiveId, v);
  }
  return out;
}

export interface SupervisionCliente {
  id: string;
  name: string;
  objetivos: number;
}

/** Clientes con objetivos, ordenados por nombre, para el filtro. */
export function clientesSupervision(objetivos: readonly SupervisionObjetivo[]): SupervisionCliente[] {
  const map = new Map<string, SupervisionCliente>();
  for (const o of objetivos) {
    const id = o.clientId || '';
    const prev = map.get(id);
    if (prev) prev.objetivos += 1;
    else map.set(id, { id, name: o.clientName || 'Sin cliente', objetivos: 1 });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Filas de la lista: filtro por cliente y búsqueda; orden = los que tienen ausentes primero,
 * después retenidos, después por cliente y nombre.
 */
export function buildSupervisionRows(input: {
  objetivos: readonly SupervisionObjetivo[];
  turnos: readonly SupervisionTurnoLite[];
  visitas: readonly SupervisionVisitaLite[];
  nowMs: number;
  clientId?: string;
  buscar?: string;
}): SupervisionRow[] {
  const porObjetivo = new Map<string, SupervisionTurnoLite[]>();
  for (const t of input.turnos) {
    const oid = String(t.objectiveId || '');
    if (!oid) continue;
    const list = porObjetivo.get(oid) || [];
    list.push(t);
    porObjetivo.set(oid, list);
  }
  const ultimas = ultimaVisitaPorObjetivo(input.visitas);
  const q = String(input.buscar || '').trim().toLowerCase();
  const rows: SupervisionRow[] = [];
  for (const o of input.objetivos) {
    if (input.clientId && o.clientId !== input.clientId) continue;
    if (q && !`${o.name} ${o.clientName} ${o.address || ''}`.toLowerCase().includes(q)) continue;
    const resumen = resumenObjetivoSupervision(porObjetivo.get(o.id) || [], input.nowMs);
    const ultima = ultimas.get(o.id) || null;
    rows.push({
      ...o,
      resumen,
      tono: tonoSupervision(resumen),
      estadoTexto: textoResumen(resumen),
      ultimaVisita: ultima,
      visitaTexto: textoVisita(ultima, input.nowMs),
      diasSinVisita: ultima?.createdAtMs ? diasDesde(ultima.createdAtMs, input.nowMs) : null,
      mapsUrl: mapsUrl(o),
    });
  }
  const peso = (r: SupervisionRow) => (r.resumen.ausentes > 0 ? 0 : r.resumen.retenidos > 0 ? 1 : 2);
  return rows.sort((a, b) => peso(a) - peso(b) || a.clientName.localeCompare(b.clientName, 'es') || a.name.localeCompare(b.name, 'es'));
}

export interface SupervisionNovedadLite extends MovilAlerta {
  id?: string;
  status?: unknown;
  title?: string;
  description?: string;
  objectiveId?: string | null;
  objectiveName?: string | null;
  createdAtMs?: number | null;
  reportedBy?: string | null;
  imageUrl?: string | null;
}

/** Novedades que son del supervisor: las que escribe «Novedad de la visita» (`source: SUPERVISION`). */
export function esAlertaDeSupervision(alerta: MovilAlerta): boolean {
  const type = String(alerta?.type || '').toUpperCase();
  if (type.startsWith('SUPERVISION_')) return true;
  return String(alerta?.source || '').toUpperCase() === SUPERVISION_SOURCE;
}

function atendida(n: { status?: unknown; viewed?: unknown }): boolean {
  if (n.viewed === true) return true;
  const s = String(n.status || '').toUpperCase();
  return s === 'ATENDIDA' || s === 'RESUELTA' || s === 'CERRADA' || s === 'READ';
}

export interface SupervisionAlertas {
  /** Objetivos sin visita en los últimos N días (o nunca visitados), con los días. */
  sinVisita: Array<{ row: SupervisionRow; dias: number | null }>;
  /** Novedades de supervisión pendientes (más nueva primero). */
  novedades: SupervisionNovedadLite[];
  total: number;
}

export function alertasSupervision(input: {
  rows: readonly SupervisionRow[];
  novedades: readonly SupervisionNovedadLite[];
  dias?: number;
}): SupervisionAlertas {
  const limite = input.dias ?? SUPERVISION_DIAS_SIN_VISITA;
  const sinVisita = input.rows
    .filter((r) => r.diasSinVisita === null || r.diasSinVisita >= limite)
    .map((row) => ({ row, dias: row.diasSinVisita }))
    .sort((a, b) => (b.dias ?? Number.MAX_SAFE_INTEGER) - (a.dias ?? Number.MAX_SAFE_INTEGER));
  const novedades = input.novedades
    .filter((n) => esAlertaDeSupervision(n) && !atendida(n))
    .slice()
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return { sinVisita, novedades, total: sinVisita.length + novedades.length };
}

export function textoSinVisita(dias: number | null, limite = SUPERVISION_DIAS_SIN_VISITA): string {
  if (dias === null) return 'Nunca visitado';
  return `${plural(dias, 'día', 'días')} sin visita · límite ${limite}`;
}

/** Hora AR corta para pies de novedad («10:20»). */
export function horaCortaAr(ms: number | null | undefined): string {
  return ms ? horaAr(ms) : '';
}

/** Resultado de la visita: texto y tono. */
export const VISITA_RESULTADOS: Array<{ id: 'OK' | 'OBSERVADO' | 'CRITICO'; label: string; tono: SupervisionTono }> = [
  { id: 'OK', label: 'Todo en orden', tono: 'emerald' },
  { id: 'OBSERVADO', label: 'Con observaciones', tono: 'orange' },
  { id: 'CRITICO', label: 'Crítico', tono: 'rose' },
];

export function tonoResultado(resultado: string | undefined): SupervisionTono {
  return VISITA_RESULTADOS.find((r) => r.id === String(resultado || '').toUpperCase())?.tono || 'slate';
}
