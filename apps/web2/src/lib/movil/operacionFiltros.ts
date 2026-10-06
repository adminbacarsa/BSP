import { addShiftToOpsBucket, ausenciaSinCubrir, shiftMatchesOpsViewTab } from '@cosp/ops-core';
import { shiftCountsInOpsHeader } from '@/lib/operaciones/opsHeaderCounts';
import { eventClientId, eventClientName, eventGroupKey, eventGroupLabel, isEventShift } from '@/lib/operaciones/eventoCc';
import type { GuardDetalleShift } from '@/lib/movil/guardDetalle';

/** Solapas del escritorio que el celular muestra como contadores-filtro. */
export type OpsEstadoFiltro = 'TODOS' | 'ACTIVOS' | 'PLAN' | 'AUSENTES' | 'VACANTES' | 'RETENIDOS' | 'NO_LLEGO';

export const MOVIL_CONTADORES: ReadonlyArray<{ id: Exclude<OpsEstadoFiltro, 'TODOS'>; label: string; corto: string; cls: string; activo: string }> = [
  { id: 'ACTIVOS', label: 'Activos', corto: 'ACT', cls: 'text-emerald-600', activo: 'ring-emerald-500 bg-emerald-50' },
  { id: 'PLAN', label: 'Plan', corto: 'PLA', cls: 'text-indigo-600', activo: 'ring-indigo-500 bg-indigo-50' },
  { id: 'NO_LLEGO', label: 'Tarde', corto: 'TAR', cls: 'text-amber-600', activo: 'ring-amber-500 bg-amber-50' },
  { id: 'AUSENTES', label: 'Aus', corto: 'AUS', cls: 'text-slate-800', activo: 'ring-slate-700 bg-slate-100' },
  { id: 'VACANTES', label: 'Vac', corto: 'VAC', cls: 'text-rose-600', activo: 'ring-rose-500 bg-rose-50' },
  { id: 'RETENIDOS', label: 'Ret', corto: 'RET', cls: 'text-orange-600', activo: 'ring-orange-500 bg-orange-50' },
];

export interface OpsFiltroMovil {
  estado: OpsEstadoFiltro;
  clientId: string | null;
  objectiveId: string | null;
}

export const FILTRO_VACIO: OpsFiltroMovil = { estado: 'TODOS', clientId: null, objectiveId: null };

/**
 * Alto hasta la primera tarjeta de guardia (panel del objetivo):
 * barra 48 + fecha 20 + margen 4 + encabezado 36 + margen 4.
 */
export const ALTO_HASTA_PRIMERA_TARJETA_PX = 48 + 20 + 4 + 36 + 4;

/** Los 6 chips (padding 24, 5 gaps de 4, chip mínimo 28) entran en el ancho. */
export function contadoresCabenEnFila(anchoPx: number): boolean {
  return anchoPx >= 24 + 5 * 4 + 6 * 28;
}

export type OpsShiftMovil = GuardDetalleShift & {
  clientId?: string;
  isFranco?: boolean;
  eventoId?: string;
  eventoNombre?: string;
  servicioId?: string;
  servicioNombre?: string;
  origin?: string;
  /** Ubicación del evento resuelta por el monitor (`eventoEnrichFields`). */
  eventoObjectiveId?: string | null;
  eventoObjectiveName?: string | null;
  eventoLugar?: string | null;
  eventoClientId?: string | null;
  eventoClientName?: string | null;
};

export interface OpsObjetivoMovil {
  objectiveId: string;
  name: string;
  client: string;
  clientId: string;
  esEvento: boolean;
  /** Evento: lugar (objetivo del evento o dirección). */
  lugar?: string | null;
  active: number;
  retention: number;
  absent: number;
  vacant: number;
  plan: number;
  shifts: OpsShiftMovil[];
}

export interface OpsClienteMovil {
  id: string;
  name: string;
  turnos: number;
  objetivos: Array<{ id: string; name: string; turnos: number }>;
}

/** Mismo criterio que el escritorio y el mapa (`lib/operaciones/eventoCc.ts`). */
export function esTurnoEvento(shift: { code?: unknown; origin?: unknown }): boolean {
  return isEventShift(shift);
}

/** Clave del grupo de una tarjeta: el evento (`EV_{eventoId}_{servicioId}`) o el objetivo. */
export function claveGrupo(shift: OpsShiftMovil): string {
  if (esTurnoEvento(shift)) return eventGroupKey(shift);
  return String(shift.objectiveId || 'unknown').trim();
}

function nombreGrupo(shift: OpsShiftMovil): string {
  if (esTurnoEvento(shift)) return eventGroupLabel(shift);
  return String(shift.objectiveName || '—').trim();
}

/** Cliente de la tarjeta: el del evento para EV, el del turno para el resto. */
function clienteDe(shift: OpsShiftMovil): { id: string; name: string } {
  if (esTurnoEvento(shift)) return { id: eventClientId(shift), name: eventClientName(shift) };
  return { id: String(shift.clientId || '').trim(), name: String(shift.clientName || '').trim() };
}

/** Objetivo de la tarjeta para filtrar: el del evento (si se conoce) para EV; nunca el de base del guardia. */
function objetivoDe(shift: OpsShiftMovil): { id: string; name: string } {
  if (esTurnoEvento(shift)) {
    return { id: String(shift.eventoObjectiveId || '').trim(), name: String(shift.eventoObjectiveName || shift.eventoLugar || '').trim() };
  }
  return { id: String(shift.objectiveId || '').trim(), name: String(shift.objectiveName || '').trim() };
}

/**
 * Universo del celular = el mismo del encabezado del escritorio: turnos de hoy
 * (`isOpsShiftHoy`, lo aplica la página) de un mes publicado o de origen operativo.
 * Los francos no son tarjetas.
 */
export function turnosVisiblesMovil<T extends OpsShiftMovil>(hoy: readonly T[], publishStatusMap: Record<string, boolean>): T[] {
  return hoy.filter((s) => shiftCountsInOpsHeader(s, publishStatusMap) && !s.isFranco);
}

export function enAmbito(shift: OpsShiftMovil, filtro: Pick<OpsFiltroMovil, 'clientId' | 'objectiveId'>): boolean {
  if (filtro.objectiveId && objetivoDe(shift).id !== filtro.objectiveId) return false;
  if (filtro.clientId && clienteDe(shift).id !== filtro.clientId) return false;
  return true;
}

export function turnosEnAmbito<T extends OpsShiftMovil>(shifts: readonly T[], filtro: Pick<OpsFiltroMovil, 'clientId' | 'objectiveId'>): T[] {
  return shifts.filter((s) => enAmbito(s, filtro));
}

/** Mismo criterio que `shiftMatchesOpsViewTab` (solapas del escritorio). */
export function cumpleEstado(shift: OpsShiftMovil, estado: OpsEstadoFiltro, now: Date): boolean {
  return shiftMatchesOpsViewTab(shift as never, estado, now);
}

export function turnosFiltrados<T extends OpsShiftMovil>(shifts: readonly T[], filtro: OpsFiltroMovil, now: Date): T[] {
  return turnosEnAmbito(shifts, filtro).filter((s) => cumpleEstado(s, filtro.estado, now));
}

/** Ausencias sin cubrir dentro del ámbito (mismo criterio que el rojo del contador AUS del escritorio). */
export function ausentesSinCubrirMovil(shifts: readonly OpsShiftMovil[], filtro: Pick<OpsFiltroMovil, 'clientId' | 'objectiveId'>, now: Date): number {
  return turnosEnAmbito(shifts, filtro).filter((s) => cumpleEstado(s, 'AUSENTES', now) && ausenciaSinCubrir(s as never)).length;
}

/** «2 AUS · 0 sin cubrir» para el aria-label / title del contador del celular. */
export function etiquetaAus(total: number, sinCubrir: number): string {
  return `${total} AUS · ${sinCubrir} sin cubrir`;
}

/** El número del contador = cantidad de tarjetas al filtrar por ese estado dentro del ámbito. */
export function contadoresMovil(shifts: readonly OpsShiftMovil[], filtro: Pick<OpsFiltroMovil, 'clientId' | 'objectiveId'>, now: Date): Record<OpsEstadoFiltro, number> {
  const ambito = turnosEnAmbito(shifts, filtro);
  const out = { TODOS: 0, ACTIVOS: 0, PLAN: 0, AUSENTES: 0, VACANTES: 0, RETENIDOS: 0, NO_LLEGO: 0 } as Record<OpsEstadoFiltro, number>;
  for (const estado of Object.keys(out) as OpsEstadoFiltro[]) {
    out[estado] = ambito.filter((s) => cumpleEstado(s, estado, now)).length;
  }
  return out;
}

/** Tarjetas agrupadas por objetivo (o evento), ordenadas por criticidad como el escritorio. */
export function agruparPorObjetivo<T extends OpsShiftMovil>(shifts: readonly T[], now: Date): Array<OpsObjetivoMovil & { shifts: T[] }> {
  const map = new Map<string, OpsObjetivoMovil & { shifts: T[] }>();
  for (const s of shifts) {
    const key = claveGrupo(s);
    let grupo = map.get(key);
    if (!grupo) {
      const cliente = clienteDe(s);
      const esEvento = esTurnoEvento(s);
      grupo = {
        objectiveId: key,
        name: nombreGrupo(s),
        client: cliente.name,
        clientId: cliente.id,
        esEvento,
        lugar: esEvento ? (String(s.eventoLugar || s.eventoObjectiveName || '').trim() || null) : null,
        active: 0, retention: 0, absent: 0, vacant: 0, plan: 0,
        shifts: [],
      };
      map.set(key, grupo);
    } else if (grupo.esEvento && !grupo.lugar) {
      grupo.lugar = String(s.eventoLugar || s.eventoObjectiveName || '').trim() || null;
    }
    grupo.shifts.push(s);
    addShiftToOpsBucket(grupo, s as never, now);
  }
  return Array.from(map.values()).sort((a, b) => {
    const scoreA = a.absent * 3 + a.vacant * 2 + a.retention;
    const scoreB = b.absent * 3 + b.vacant * 2 + b.retention;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.name.localeCompare(b.name, 'es');
  });
}

/** Cliente → objetivos, con cantidad de turnos visibles hoy. El catálogo completa objetivos sin turnos. */
export function clientesParaFiltro(
  shifts: readonly OpsShiftMovil[],
  catalogo: ReadonlyArray<{ id?: unknown; clientId?: unknown; name?: unknown; clientName?: unknown }> = [],
): OpsClienteMovil[] {
  const clientes = new Map<string, OpsClienteMovil>();
  const agregarObjetivo = (clientId: string, clientName: string, objectiveId: string, objectiveName: string) => {
    let c = clientes.get(clientId);
    if (!c) {
      c = { id: clientId, name: clientName || clientId, turnos: 0, objetivos: [] };
      clientes.set(clientId, c);
    }
    if (!c.name && clientName) c.name = clientName;
    let o = c.objetivos.find((row) => row.id === objectiveId);
    if (!o && objectiveId) {
      o = { id: objectiveId, name: objectiveName || objectiveId, turnos: 0 };
      c.objetivos.push(o);
    }
    return { c, o };
  };
  for (const row of catalogo) {
    const clientId = String(row.clientId || '').trim();
    if (!clientId) continue;
    agregarObjetivo(clientId, String(row.clientName || '').trim(), String(row.id || '').trim(), String(row.name || '').trim());
  }
  for (const s of shifts) {
    // EV cuenta para el cliente y el objetivo del evento, no para el objetivo de base del guardia.
    const cliente = clienteDe(s);
    if (!cliente.id) continue;
    const objetivo = objetivoDe(s);
    const { c, o } = agregarObjetivo(cliente.id, cliente.name, objetivo.id, objetivo.name);
    c.turnos++;
    if (o) o.turnos++;
  }
  return Array.from(clientes.values())
    .map((c) => ({ ...c, objetivos: [...c.objetivos].sort((a, b) => b.turnos - a.turnos || a.name.localeCompare(b.name, 'es')) }))
    .sort((a, b) => b.turnos - a.turnos || a.name.localeCompare(b.name, 'es'));
}

function fold(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Buscador de la hoja: cliente u objetivo que contenga el texto; el cliente conserva solo los objetivos que matchean (o todos si matchea él). */
export function buscarClientes(clientes: readonly OpsClienteMovil[], texto: string): OpsClienteMovil[] {
  const q = fold(texto);
  if (!q) return [...clientes];
  return clientes
    .map((c) => {
      if (fold(c.name).includes(q)) return c;
      const objetivos = c.objetivos.filter((o) => fold(o.name).includes(q));
      return objetivos.length ? { ...c, objetivos } : null;
    })
    .filter((c): c is OpsClienteMovil => c !== null);
}

export function etiquetaAmbito(filtro: Pick<OpsFiltroMovil, 'clientId' | 'objectiveId'>, clientes: readonly OpsClienteMovil[]): string | null {
  if (!filtro.clientId && !filtro.objectiveId) return null;
  const cliente = clientes.find((c) => c.id === filtro.clientId) || clientes.find((c) => c.objetivos.some((o) => o.id === filtro.objectiveId));
  const objetivo = filtro.objectiveId ? cliente?.objetivos.find((o) => o.id === filtro.objectiveId) : null;
  if (objetivo) return objetivo.name;
  return cliente?.name || filtro.clientId || filtro.objectiveId || null;
}

export function etiquetaEstado(estado: OpsEstadoFiltro): string {
  return MOVIL_CONTADORES.find((c) => c.id === estado)?.corto || 'Todos';
}

/** «Sin guardias en AUS para Peaje 9 Norte» / «Sin guardias en AUS» / «Sin guardias para X». */
export function mensajeVacio(filtro: OpsFiltroMovil, clientes: readonly OpsClienteMovil[]): string {
  const ambito = etiquetaAmbito(filtro, clientes);
  const estado = filtro.estado === 'TODOS' ? '' : ` en ${etiquetaEstado(filtro.estado)}`;
  return `Sin guardias${estado}${ambito ? ` para ${ambito}` : ''}`;
}

/** Tocar el contador activo vuelve a Todos. */
export function alternarEstado(filtro: OpsFiltroMovil, estado: OpsEstadoFiltro): OpsFiltroMovil {
  return { ...filtro, estado: filtro.estado === estado ? 'TODOS' : estado };
}

const STORAGE_PREFIX = 'cosp-movil-op-filtro:';

export function leerFiltroGuardado(empresaId: string, storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.sessionStorage): OpsFiltroMovil {
  if (!storage) return FILTRO_VACIO;
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${empresaId}`);
    if (!raw) return FILTRO_VACIO;
    const data = JSON.parse(raw) as Partial<OpsFiltroMovil>;
    const estado = (['TODOS', 'ACTIVOS', 'PLAN', 'AUSENTES', 'VACANTES', 'RETENIDOS', 'NO_LLEGO'] as OpsEstadoFiltro[]).includes(data.estado as OpsEstadoFiltro)
      ? (data.estado as OpsEstadoFiltro)
      : 'TODOS';
    return {
      estado,
      clientId: typeof data.clientId === 'string' && data.clientId ? data.clientId : null,
      objectiveId: typeof data.objectiveId === 'string' && data.objectiveId ? data.objectiveId : null,
    };
  } catch {
    return FILTRO_VACIO;
  }
}

export function guardarFiltro(empresaId: string, filtro: OpsFiltroMovil, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = typeof window === 'undefined' ? null : window.sessionStorage): void {
  if (!storage) return;
  try {
    const key = `${STORAGE_PREFIX}${empresaId}`;
    if (filtro.estado === 'TODOS' && !filtro.clientId && !filtro.objectiveId) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(filtro));
  } catch {
    // sessionStorage puede estar bloqueado (modo privado): el filtro vive solo en memoria.
  }
}
