import { sumPublishedPlanHours, type PublishedPlanHours } from '@cosp/hours-core';
import { cruceTopeDeTurnos, type CruceTope } from '@/lib/planificacion/topeGrilla';

/**
 * Columna de la grilla: la misma jornada que el plan publicado (hoursOf),
 * sobre lo que el planificador ve (publicado + borrador + cambios sin guardar).
 * El total oficial sigue siendo solo lo publicado.
 */
export type PlannerColumnInput = {
  cellTurnosMap: Record<string, any[] | undefined>;
  shiftsMap: Record<string, any>;
  pendingChanges: Record<string, any>;
  /** Objetivos de la vista. En grupo unificado, todos los del grupo. */
  objectiveIds: string[];
  /** true = solo entran turnos de objectiveIds (un objetivo vacío no cuenta). */
  groupMode: boolean;
  employeeIds: string[];
  /** YYYY-MM del mes que se ve: los borradores de otro mes no suman. */
  mes?: string;
};

export type PlannerColumnHours = {
  byEmployee: Record<string, number>;
  published: PublishedPlanHours;
  working: PublishedPlanHours;
};

const CELL_DATE = /_(\d{4}-\d{2}-\d{2})$/;

function empFromCellKey(key: string): string {
  const m = key.match(CELL_DATE);
  if (!m || m.index == null) return '';
  return key.slice(0, m.index);
}

/** El pending de la grilla a veces trae solo el código y un horario HH:MM: el legajo y el día están en la clave. */
function withCellEmployee(shift: any, key: string): any {
  const emp = String(shift?.employeeId || '').trim() || empFromCellKey(key);
  const fecha = key.match(CELL_DATE)?.[1] || '';
  const tieneFecha = typeof shift?.dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(shift.dateStr);
  const mismoEmp = !!emp && emp === String(shift?.employeeId || '');
  if (mismoEmp && (tieneFecha || !fecha)) return shift;
  return {
    ...shift,
    ...(!mismoEmp && emp ? { employeeId: emp } : {}),
    ...(!tieneFecha && fecha ? { dateStr: fecha } : {}),
  };
}

function inScope(shift: any, objectiveIds: string[], groupMode: boolean): boolean {
  const ao = String(shift?.objectiveId || '').trim();
  if (!ao) return !groupMode;
  if (!objectiveIds.length) return true;
  return objectiveIds.includes(ao);
}

/** `seen` evita el barrido O(n) por turno. Sin id no se deduplica: igual que antes. */
function pushUnique(list: any[], shift: any, seen: Set<string>) {
  if (!shift || typeof shift !== 'object') return;
  const id = String(shift.id || '');
  if (id) {
    if (seen.has(id)) return;
    seen.add(id);
  }
  list.push(shift);
}

function claveDelMes(key: string, mes?: string): boolean {
  if (!mes) return true;
  const m = String(key).match(/_(\d{4}-\d{2})-\d{2}(?:_B2)?$/);
  return !m || m[1] === mes;
}

function guardIdDeClave(key: string): string {
  return empFromCellKey(key) || `\0${key}`;
}

type ParteClave = { saved: any[]; visible: any[] };

/** Misma cubeta por celda que el armado completo: el pending pisa lo visible. */
function parteDeClave(key: string, input: PlannerColumnInput): ParteClave {
  const { cellTurnosMap, shiftsMap, pendingChanges, objectiveIds, groupMode } = input;
  const saved: any[] = [];
  const seen = new Set<string>();
  const add = (shift: any) => {
    const stamped = withCellEmployee(shift, key);
    if (!inScope(stamped, objectiveIds, groupMode)) return;
    pushUnique(saved, stamped, seen);
  };
  const arr = cellTurnosMap?.[key];
  if (Array.isArray(arr)) arr.forEach(add);
  if (shiftsMap && Object.prototype.hasOwnProperty.call(shiftsMap, key)) add(shiftsMap[key]);

  const pending = pendingChanges?.[key];
  if (pending?.isDeleted) return { saved, visible: [] };
  if (pending && pending.isDeleted !== true) {
    const stamped = withCellEmployee(pending, key);
    if (inScope(stamped, objectiveIds, groupMode)) return { saved, visible: [stamped] };
    return { saved, visible: [] };
  }
  return { saved, visible: saved };
}

function entraEnCubeta(shift: any, objectiveIds: string[], groupMode: boolean): boolean {
  return inScope(shift, objectiveIds, groupMode);
}

/** Orden de claves idéntico al Set del armado: cubetas de celdas, luego shifts, luego pending del mes. */
function ordenDeClaves(input: PlannerColumnInput): string[] {
  const { cellTurnosMap, shiftsMap, pendingChanges, objectiveIds, groupMode, mes } = input;
  const seen = new Set<string>();
  const order: string[] = [];
  const take = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    order.push(key);
  };
  for (const [key, arr] of Object.entries(cellTurnosMap || {})) {
    if (!Array.isArray(arr)) continue;
    if (arr.some((t) => entraEnCubeta(t, objectiveIds, groupMode))) take(key);
  }
  for (const [key, shift] of Object.entries(shiftsMap || {})) {
    if (entraEnCubeta(shift, objectiveIds, groupMode)) take(key);
  }
  for (const key of Object.keys(pendingChanges || {})) {
    if (seen.has(key) || !claveDelMes(key, mes)) continue;
    take(key);
  }
  return order;
}

function fusionarPartes(order: string[], partDe: (key: string) => ParteClave | undefined): { saved: any[]; visible: any[] } {
  const saved: any[] = [];
  const visible: any[] = [];
  const seenS = new Set<string>();
  const seenV = new Set<string>();
  for (const key of order) {
    const part = partDe(key);
    if (!part) continue;
    for (const t of part.saved) pushUnique(saved, t, seenS);
    for (const t of part.visible) pushUnique(visible, t, seenV);
  }
  return { saved, visible };
}

/** Arma lo guardado y lo visible (pending pisa la celda; borrar sin guardar la vacía). */
export function collectPlannerColumnShifts(input: PlannerColumnInput): { saved: any[]; visible: any[] } {
  const order = ordenDeClaves(input);
  const parts = new Map<string, ParteClave>();
  for (const key of order) parts.set(key, parteDeClave(key, input));
  return fusionarPartes(order, (key) => parts.get(key));
}

function horasDeVisibles(visible: any[]): Map<string, number> {
  const byEmp = new Map<string, any[]>();
  for (const t of visible) {
    const emp = String(t?.employeeId || '').trim();
    if (!emp) continue;
    const list = byEmp.get(emp) || [];
    list.push(t);
    byEmp.set(emp, list);
  }
  const hoursByEmp = new Map<string, number>();
  for (const [emp, list] of byEmp) {
    hoursByEmp.set(emp, sumPublishedPlanHours(list, { anyDraftState: true }).hours);
  }
  return hoursByEmp;
}

function armarByEmployee(
  ids: string[],
  hoursByEmp: Map<string, number>,
  prev?: Record<string, number>,
): Record<string, number> {
  if (prev) {
    const prevKeys = Object.keys(prev);
    if (prevKeys.length === ids.length) {
      const have = new Set(prevKeys);
      let same = true;
      for (const id of ids) {
        if (!have.has(id) || prev[id] !== (hoursByEmp.get(String(id)) || 0)) {
          same = false;
          break;
        }
      }
      if (same) return prev;
    }
  }
  const byEmployee: Record<string, number> = {};
  for (const id of ids) byEmployee[id] = hoursByEmp.get(String(id)) || 0;
  return byEmployee;
}

function mismoTope(a: Record<string, CruceTope>, b: Record<string, CruceTope>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    const x = a[k];
    const y = b[k];
    if (!y || x.dateStr !== y.dateStr || x.acumuladas !== y.acumuladas || x.total !== y.total) return false;
  }
  return true;
}

function columnaDe(
  saved: any[],
  visible: any[],
  employeeIds: string[],
  hoursByEmp: Map<string, number>,
  prevBy?: Record<string, number>,
): PlannerColumnHours {
  return {
    byEmployee: armarByEmployee(employeeIds, hoursByEmp, prevBy),
    published: sumPublishedPlanHours(saved),
    working: sumPublishedPlanHours(visible, { anyDraftState: true }),
  };
}

export function buildPlannerColumnHours(input: PlannerColumnInput): PlannerColumnHours {
  const { saved, visible } = collectPlannerColumnShifts(input);
  return columnaDe(saved, visible, input.employeeIds, horasDeVisibles(visible));
}

type GuardCache = {
  refs: unknown[];
  parts: Map<string, ParteClave>;
};

export type PlannerColumnCache = {
  scope: string;
  monthly: number;
  employeeIdsKey: string;
  keyOrder: string[];
  guards: Map<string, GuardCache>;
  saved: any[];
  visible: any[];
  hoursByEmp: Map<string, number>;
  column: PlannerColumnHours;
  cruce: Record<string, CruceTope>;
};

function scopeDe(input: PlannerColumnInput): string {
  return `${input.groupMode ? 1 : 0}|${input.mes || ''}|${input.objectiveIds.join('\0')}`;
}

function refsDeGuardia(keys: string[], input: PlannerColumnInput): unknown[] {
  const { cellTurnosMap, shiftsMap, pendingChanges } = input;
  const refs: unknown[] = [];
  for (const key of keys) refs.push(key, cellTurnosMap?.[key], shiftsMap?.[key], pendingChanges?.[key]);
  return refs;
}

function mismosRefs(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function clavesPorGuardia(order: string[]): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const key of order) {
    const id = guardIdDeClave(key);
    const list = by.get(id);
    if (list) list.push(key);
    else by.set(id, [key]);
  }
  return by;
}

/**
 * Una sola pasada de turnos para la columna y el cruce de 200 h.
 * Si el objetivo y el mes no cambian, solo rearma los guardias cuyas celdas
 * (pending / turno guardado) cambiaron de identidad.
 */
export function planificarColumnaConCache(
  input: PlannerColumnInput,
  monthly: number,
  ymd: (shift: any) => string,
  prev: PlannerColumnCache | null,
): { column: PlannerColumnHours; cruce: Record<string, CruceTope>; cache: PlannerColumnCache } {
  const scope = scopeDe(input);
  const order = ordenDeClaves(input);
  const idsKey = input.employeeIds.join('\0');
  const base = prev && prev.scope === scope ? prev : null;
  const byGuard = clavesPorGuardia(order);
  const guards = new Map<string, GuardCache>();
  let sucios = !base;
  for (const [id, keys] of byGuard) {
    const refs = refsDeGuardia(keys, input);
    const old = base?.guards.get(id);
    if (old && mismosRefs(old.refs, refs)) {
      guards.set(id, old);
      continue;
    }
    sucios = true;
    const parts = new Map<string, ParteClave>();
    for (const key of keys) parts.set(key, parteDeClave(key, input));
    guards.set(id, { refs, parts });
  }
  const orderSame = !!base
    && base.keyOrder.length === order.length
    && base.keyOrder.every((k, i) => k === order[i]);
  if (base && !sucios && orderSame && base.monthly === monthly && base.employeeIdsKey === idsKey) {
    return { column: base.column, cruce: base.cruce, cache: base };
  }

  let saved = base?.saved || [];
  let visible = base?.visible || [];
  let hoursByEmp = base?.hoursByEmp || new Map<string, number>();
  let published = base?.column.published;
  let working = base?.column.working;
  if (!base || sucios || !orderSame) {
    const fused = fusionarPartes(order, (key) => guards.get(guardIdDeClave(key))?.parts.get(key));
    saved = fused.saved;
    visible = fused.visible;
    hoursByEmp = horasDeVisibles(visible);
    published = sumPublishedPlanHours(saved);
    working = sumPublishedPlanHours(visible, { anyDraftState: true });
  }

  const columnBase: PlannerColumnHours = {
    byEmployee: armarByEmployee(input.employeeIds, hoursByEmp, base?.column.byEmployee),
    published: published!,
    working: working!,
  };
  const column = base
    && columnBase.byEmployee === base.column.byEmployee
    && columnBase.published === base.column.published
    && columnBase.working === base.column.working
    ? base.column
    : columnBase;

  let cruce = base?.cruce || {};
  if (!base || sucios || !orderSame || base.monthly !== monthly) {
    const next = cruceTopeDeTurnos(visible, ymd, monthly);
    cruce = base && mismoTope(base.cruce, next) ? base.cruce : next;
  }

  const cache: PlannerColumnCache = {
    scope,
    monthly,
    employeeIdsKey: idsKey,
    keyOrder: orderSame && base ? base.keyOrder : order,
    guards,
    saved,
    visible,
    hoursByEmp,
    column,
    cruce,
  };
  return { column, cruce, cache };
}
