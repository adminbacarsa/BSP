/**
 * Semana a la vista del celular. La estructura de puestos y franjas sale de las mismas
 * funciones que la grilla de escritorio (`slaPlanningMatch`); acá solo se recorta a 7 días.
 */
import {
  buildPlanningPositionStructure,
  filterSlasForPlanningContext,
  filterSlasForPlanningTenant,
  getEffectiveShiftQuantityOnDate,
  isPlanningPositionExcludedOnDate,
  isPlanningShiftExcludedOnDate,
  pickClosedSlaForPlanningMonth,
  pickSlaForPlanningMonth,
  planningMonthHasActiveSla,
  type PlanningPositionRow,
  type SlaPlanningRow,
} from '@/lib/slaPlanningMatch';
import type { PlanningPositionShiftRow } from '@/lib/planningPositionDays';
import { hoursBetweenClockTimes } from '@/lib/planificacion/planningScheduledHours';
import { buscarClientes, clientesParaFiltro, type OpsClienteMovil } from '@/lib/movil/operacionFiltros';
import { bandaDe, sumarDias, type FranjaMovil, type TurnoMovil } from '@/lib/movil/planificacionBasica';

export { buscarClientes, type OpsClienteMovil };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIA_LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
export const DIAS_CORTOS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];

function diaSemanaUtc(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Lunes de la semana que contiene la fecha. */
export function lunesDe(fecha: string): string {
  const dow = diaSemanaUtc(fecha);
  return sumarDias(fecha, dow === 0 ? -6 : 1 - dow);
}

export function semanaDe(fecha: string): string[] {
  const lunes = lunesDe(fecha);
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

export function semanaSiguiente(lunes: string): string {
  return sumarDias(lunes, 7);
}

export function semanaAnterior(lunes: string): string {
  return sumarDias(lunes, -7);
}

/** Mes que «manda» en la semana: el que tiene más días (empate → el del jueves). */
export function mesDeSemana(lunes: string): string {
  const dias = semanaDe(lunes);
  const cuenta = new Map<string, number>();
  for (const d of dias) cuenta.set(d.slice(0, 7), (cuenta.get(d.slice(0, 7)) || 0) + 1);
  const max = Math.max(...cuenta.values());
  const ganadores = [...cuenta.entries()].filter(([, n]) => n === max).map(([ym]) => ym);
  return ganadores.length === 1 ? ganadores[0] : dias[3].slice(0, 7);
}

/** «Semana 2 de octubre · 6–12». Si cruza mes: «Semana 5 de septiembre · 28 sep–4 oct». */
export function etiquetaSemana(lunes: string): string {
  const dias = semanaDe(lunes);
  const ym = mesDeSemana(lunes);
  const [y, m] = ym.split('-').map(Number);
  const primerLunes = lunesDe(`${ym}-01`);
  const indice = Math.round((Date.parse(`${lunes}T00:00:00Z`) - Date.parse(`${primerLunes}T00:00:00Z`)) / (7 * 86400000)) + 1;
  const mes = MESES[m - 1] || ym;
  const d0 = dias[0];
  const d6 = dias[6];
  const dd = (f: string) => String(Number(f.slice(8, 10)));
  const mm = (f: string) => (MESES[Number(f.slice(5, 7)) - 1] || '').slice(0, 3);
  const rango = d0.slice(0, 7) === d6.slice(0, 7) ? `${dd(d0)}–${dd(d6)}` : `${dd(d0)} ${mm(d0)}–${dd(d6)} ${mm(d6)}`;
  const anio = y !== Number(lunes.slice(0, 4)) ? ` ${y}` : '';
  return `Semana ${indice} de ${mes}${anio} · ${rango}`;
}

export function mesesDeSemana(lunes: string): string[] {
  return [...new Set(semanaDe(lunes).map((d) => d.slice(0, 7)))];
}

/** Umbral de 50 px horizontales y menos desvío vertical: izquierda = siguiente, derecha = anterior. */
export function direccionSwipe(dx: number, dy: number, umbral = 50): 'anterior' | 'siguiente' | null {
  if (Math.abs(dx) < umbral || Math.abs(dy) > Math.abs(dx)) return null;
  return dx < 0 ? 'siguiente' : 'anterior';
}

export type ClienteCatalogo = { id: string; name: string; objetivos: Array<{ id: string; name: string; objectiveId?: string }> };

export function clientesParaSelector(clientes: readonly ClienteCatalogo[]): OpsClienteMovil[] {
  return clientesParaFiltro([], clientes.flatMap((c) => c.objetivos.map((o) => ({ id: o.id, name: o.name, clientId: c.id, clientName: c.name }))))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((c) => ({ ...c, objetivos: [...c.objetivos].sort((a, b) => a.name.localeCompare(b.name, 'es')) }));
}

export type SeleccionPlan = { clientId: string; objectiveId: string } | null;

const STORAGE_PREFIX = 'cosp-movil-plan:';

export function leerSeleccion(empresaId: string, storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage): SeleccionPlan {
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${empresaId}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as { clientId?: unknown; objectiveId?: unknown };
    if (typeof data.clientId === 'string' && typeof data.objectiveId === 'string' && data.clientId && data.objectiveId) {
      return { clientId: data.clientId, objectiveId: data.objectiveId };
    }
    return null;
  } catch {
    return null;
  }
}

export function guardarSeleccion(empresaId: string, sel: SeleccionPlan, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = typeof window === 'undefined' ? null : window.localStorage): void {
  if (!storage) return;
  try {
    const key = `${STORAGE_PREFIX}${empresaId}`;
    if (!sel) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(sel));
  } catch {
    // Sin storage la selección vive en memoria.
  }
}

/** Misma selección de contrato que la grilla: tenant → cliente/objetivo → vigente del mes (o cerrado) → estructura. */
export function estructuraSlaDelMes(input: {
  slas: SlaPlanningRow[];
  empresaId: string;
  scopeEmpresa: boolean;
  clientes: ClienteCatalogo[];
  clientId: string;
  objectiveId: string;
  ym: string;
}): { estructura: PlanningPositionRow[]; conSla: boolean; cerrado: boolean } {
  const [year, month1] = input.ym.split('-').map(Number);
  const month = month1 - 1;
  const tenantClientIds = new Set(input.clientes.map((c) => c.id));
  const allDocs = filterSlasForPlanningTenant(input.slas, input.empresaId, input.scopeEmpresa, tenantClientIds);
  const matching = filterSlasForPlanningContext(allDocs, input.clientId, input.objectiveId, input.clientes);
  const openPick = pickSlaForPlanningMonth(matching, year, month);
  const closedSla = openPick.vigente ? null : pickClosedSlaForPlanningMonth(matching, year, month);
  const srv = openPick.vigente ?? closedSla;
  const hasExactMatch = openPick.hasExactMatch || !!closedSla;
  const monthHasSla = planningMonthHasActiveSla(matching, year, month) || !!closedSla;
  const { structure } = buildPlanningPositionStructure(srv ?? openPick.fallback, { monthHasSla, hasExactMatch });
  return { estructura: structure, conSla: monthHasSla, cerrado: !!closedSla && !openPick.vigente };
}

export type FilaSemana = {
  id: string;
  positionName: string;
  code: string;
  start: string;
  end: string;
  hours: number;
  qty: number;
  pos: PlanningPositionRow;
  shift: PlanningPositionShiftRow;
};

const NO_LABORAL = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'E', 'A', 'AA', 'PG', 'ART', 'SUS', 'SGS']);

function hhmmSla(raw: unknown): string | null {
  const m = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/**
 * Turnos que el SLA vende en el puesto. La estructura de escritorio agrega D12/N12 sin horario
 * a los puestos 24 h para el modal: si el puesto ya define turnos con horario (o vende M/T/N),
 * esos dos genéricos no son turnos propios.
 */
export function turnosPropiosDelPuesto(pos: PlanningPositionRow): PlanningPositionShiftRow[] {
  const codes = new Set(pos.shifts.map((s) => String(s.code || '').toUpperCase()));
  const vendeMtn = codes.has('M') && codes.has('T') && codes.has('N');
  const conHorario = pos.shifts.some((s) => hhmmSla(s.startTime) != null);
  return pos.shifts.filter((s) => {
    const code = String(s.code || '').toUpperCase();
    if (!code || NO_LABORAL.has(code)) return false;
    if (code !== 'D12' && code !== 'N12') return true;
    if (!vendeMtn && !conHorario) return true;
    return hhmmSla(s.startTime) != null;
  });
}

/**
 * Mismo criterio que el selector de turno de la grilla (bloqueo por turno): exclusión del puesto
 * o de la banda ese día, `specificDates` manda sobre `days`, y `days` (L M X J V S D) limita el día.
 */
export function turnoHabilitadoEnFecha(pos: PlanningPositionRow, shift: PlanningPositionShiftRow, fecha: string): boolean {
  const code = String(shift.code || '').toUpperCase();
  if (isPlanningPositionExcludedOnDate(pos, fecha)) return false;
  if (isPlanningShiftExcludedOnDate(pos, fecha, code)) return false;
  if (Array.isArray(shift.specificDates) && shift.specificDates.length > 0) return shift.specificDates.includes(fecha);
  const letra = DIA_LETRA[diaSemanaUtc(fecha)];
  if (Array.isArray(shift.days) && shift.days.length > 0) return shift.days.includes(letra);
  return !pos.activeDays?.length || pos.activeDays.includes(letra);
}

export type OpcionTurno = { id: string; code: string; start: string; end: string; hours: number; label: string };

function opcionDe(code: string, startRaw: unknown, endRaw: unknown, hoursRaw: unknown): OpcionTurno | null {
  const banda = bandaDe(code);
  const start = hhmmSla(startRaw) || banda?.start || '';
  const end = hhmmSla(endRaw) || banda?.end || '';
  if (!start || !end) return null;
  const hours = hoursBetweenClockTimes(start, end) ?? (Number(hoursRaw) > 0 ? Number(hoursRaw) : banda?.hours ?? 8);
  return { id: `${code}|${start}|${end}`, code, start, end, hours, label: `${code} ${start}–${end}` };
}

export const OPCIONES_GENERICAS: OpcionTurno[] = ['M', 'T', 'N', 'D12', 'N12']
  .map((code) => opcionDe(code, null, null, null))
  .filter((o): o is OpcionTurno => o != null);

/**
 * Turnos habilitados del SLA para ese puesto y ese día («M2 11:00–15:00»). Los genéricos
 * M/T/N/D12/N12 solo si el puesto no tiene SLA o el SLA no define turnos.
 */
export function opcionesTurnoDelDia(pos: PlanningPositionRow | null | undefined, fecha: string): OpcionTurno[] {
  if (!pos) return OPCIONES_GENERICAS;
  const propios = turnosPropiosDelPuesto(pos);
  if (propios.length === 0) return OPCIONES_GENERICAS;
  const out: OpcionTurno[] = [];
  for (const s of propios) {
    if (!turnoHabilitadoEnFecha(pos, s, fecha)) continue;
    const op = opcionDe(String(s.code).toUpperCase(), s.startTime, s.endTime, s.hours);
    if (op && !out.some((o) => o.id === op.id)) out.push(op);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.code.localeCompare(b.code));
}

export function puestoDe(estructura: PlanningPositionRow[] | null | undefined, positionName: string): PlanningPositionRow | null {
  if (!estructura?.length) return null;
  return estructura.find((p) => p.positionName === positionName) || (estructura.length === 1 ? estructura[0] : null);
}

/** Opción que corresponde al turno actual (mismo código y horario; si no, mismo código). */
export function opcionDelTurno(opciones: OpcionTurno[], t: { code: string; start: string; end: string }): OpcionTurno | null {
  return opciones.find((o) => o.code === t.code && o.start === t.start && o.end === t.end)
    || opciones.find((o) => o.start === t.start && o.end === t.end)
    || opciones.find((o) => o.code === t.code)
    || null;
}

/** Filas = puesto × turno propio del SLA, con su horario. */
export function filasSemana(estructura: PlanningPositionRow[]): FilaSemana[] {
  const filas: FilaSemana[] = [];
  for (const pos of estructura) {
    for (const s of turnosPropiosDelPuesto(pos)) {
      const code = String(s.code || '').toUpperCase();
      const op = opcionDe(code, s.startTime, s.endTime, s.hours);
      filas.push({
        id: `${pos.positionName}|${code}`,
        positionName: pos.positionName,
        code,
        start: op?.start || '',
        end: op?.end || '',
        hours: op?.hours || 8,
        qty: Math.max(1, Number(s.quantity) || pos.qty || 1),
        pos,
        shift: s,
      });
    }
  }
  return filas;
}

export type CeldaSemana = {
  fila: FilaSemana;
  fecha: string;
  guardias: TurnoMovil[];
  /** Lugares vendidos ese día (0 = el puesto no opera). */
  cupo: number;
  faltan: number;
  kind: 'ok' | 'hueco' | 'sin-servicio';
};

export function celdaSemana(fila: FilaSemana, fecha: string, turnos: readonly TurnoMovil[], objectiveId: string): CeldaSemana {
  const guardias = turnos.filter((t) => t.objectiveId === objectiveId && t.date === fecha && !t.licencia && !t.franco
    && t.code === fila.code && (t.positionName || 'General') === fila.positionName);
  const activo = turnoHabilitadoEnFecha(fila.pos, fila.shift, fecha);
  const cupo = activo ? getEffectiveShiftQuantityOnDate(fila.pos, fecha, fila.code, fila.qty) : 0;
  const cubiertos = guardias.filter((g) => !g.vacante).length;
  const faltan = Math.max(0, cupo - cubiertos);
  const kind: CeldaSemana['kind'] = cupo === 0 ? (guardias.length ? 'ok' : 'sin-servicio') : faltan > 0 ? 'hueco' : 'ok';
  return { fila, fecha, guardias, cupo, faltan, kind };
}

export function celdasSemana(filas: FilaSemana[], dias: string[], turnos: readonly TurnoMovil[], objectiveId: string): CeldaSemana[][] {
  return filas.map((fila) => dias.map((fecha) => celdaSemana(fila, fecha, turnos, objectiveId)));
}

/** Licencias del objetivo esa semana (fila aparte: no tienen puesto/franja). Sin `coveredBy` = hueco. */
export function licenciasSemana(dias: string[], turnos: readonly TurnoMovil[], objectiveId: string): TurnoMovil[] {
  return turnos.filter((t) => t.objectiveId === objectiveId && dias.includes(t.date) && t.licencia);
}

export function huecosSemana(celdas: CeldaSemana[][], licencias: readonly TurnoMovil[]): number {
  return celdas.flat().reduce((acc, c) => acc + c.faltan, 0) + licencias.filter((l) => !l.coveredBy).length;
}

/** Vacante sintética de la celda: el doc puede no existir todavía (hueco del SLA sin turno). */
export function huecoDeCelda(celda: CeldaSemana, objetivo: { id: string; name: string; clientId: string; clientName: string }): FranjaMovil {
  const vacanteDoc = celda.guardias.find((g) => g.vacante);
  if (vacanteDoc) return { ...vacanteDoc, kind: 'vacante' };
  return {
    id: `slot:${objetivo.id}|${celda.fila.positionName}|${celda.fila.code}|${celda.fecha}`,
    employeeId: 'VACANTE',
    employeeName: 'Vacante',
    code: celda.fila.code,
    objectiveId: objetivo.id,
    objectiveName: objetivo.name,
    positionName: celda.fila.positionName,
    clientId: objetivo.clientId,
    clientName: objetivo.clientName,
    date: celda.fecha,
    start: celda.fila.start,
    end: celda.fila.end,
    hours: celda.fila.hours,
    vacante: true,
    licencia: false,
    coveredBy: '',
    franco: false,
    kind: 'vacante',
  };
}

export function esSlotSintetico(id: string): boolean {
  return id.startsWith('slot:');
}

/** Apellido corto para la celda de 7 columnas: «BAEZ», «GUERRERO…». */
export function apellidoCorto(nombre: string, max = 8): string {
  const limpio = String(nombre || '').trim();
  if (!limpio) return '';
  const apellido = (limpio.includes(',') ? limpio.split(',')[0] : limpio.split(/\s+/)[0]).toUpperCase();
  return apellido.length > max ? `${apellido.slice(0, max - 1)}…` : apellido;
}
