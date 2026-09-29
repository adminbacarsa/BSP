import { sumPublishedPlanHours, type PublishedPlanHours } from '@cosp/hours-core';

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

/** El pending de la grilla a veces trae solo el código: el legajo está en la clave de la celda. */
function withCellEmployee(shift: any, key: string): any {
  const emp = String(shift?.employeeId || '').trim() || empFromCellKey(key);
  if (!emp || emp === String(shift?.employeeId || '')) return shift;
  return { ...shift, employeeId: emp };
}

function inScope(shift: any, objectiveIds: string[], groupMode: boolean): boolean {
  const ao = String(shift?.objectiveId || '').trim();
  if (!ao) return !groupMode;
  if (!objectiveIds.length) return true;
  return objectiveIds.includes(ao);
}

function pushUnique(list: any[], shift: any) {
  if (!shift || typeof shift !== 'object') return;
  const id = String(shift.id || '');
  if (id && list.some((s) => String(s.id || '') === id)) return;
  list.push(shift);
}

/** Arma lo guardado y lo visible (pending pisa la celda; borrar sin guardar la vacía). */
export function collectPlannerColumnShifts(input: PlannerColumnInput): { saved: any[]; visible: any[] } {
  const { cellTurnosMap, shiftsMap, pendingChanges, objectiveIds, groupMode } = input;
  const buckets = new Map<string, any[]>();
  const add = (key: string, shift: any) => {
    const stamped = withCellEmployee(shift, key);
    if (!inScope(stamped, objectiveIds, groupMode)) return;
    const list = buckets.get(key) || [];
    pushUnique(list, stamped);
    buckets.set(key, list);
  };
  for (const [key, arr] of Object.entries(cellTurnosMap || {})) {
    if (Array.isArray(arr)) arr.forEach((t) => add(key, t));
  }
  for (const [key, shift] of Object.entries(shiftsMap || {})) add(key, shift);

  const saved: any[] = [];
  const visible: any[] = [];
  const keys = new Set<string>([...buckets.keys(), ...Object.keys(pendingChanges || {})]);
  for (const key of keys) {
    const cell = buckets.get(key) || [];
    cell.forEach((t) => pushUnique(saved, t));
    const pending = pendingChanges?.[key];
    if (pending?.isDeleted) continue;
    if (pending && pending.isDeleted !== true) {
      const stamped = withCellEmployee(pending, key);
      if (inScope(stamped, objectiveIds, groupMode)) pushUnique(visible, stamped);
      continue;
    }
    cell.forEach((t) => pushUnique(visible, t));
  }
  return { saved, visible };
}

export function buildPlannerColumnHours(input: PlannerColumnInput): PlannerColumnHours {
  const { saved, visible } = collectPlannerColumnShifts(input);
  const published = sumPublishedPlanHours(saved);
  const working = sumPublishedPlanHours(visible, { anyDraftState: true });
  const byEmp = new Map<string, any[]>();
  for (const t of visible) {
    const emp = String(t?.employeeId || '').trim();
    if (!emp) continue;
    const list = byEmp.get(emp) || [];
    list.push(t);
    byEmp.set(emp, list);
  }
  const byEmployee: Record<string, number> = {};
  for (const id of input.employeeIds) {
    byEmployee[id] = sumPublishedPlanHours(byEmp.get(String(id)) || [], { anyDraftState: true }).hours;
  }
  return { byEmployee, published, working };
}
