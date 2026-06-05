import { clientRowMatchesClient, type ClientRef } from './clientDataMatch';
import { getDateKeyInTimezone, isProformaVacancyShift } from './proformaGrid';
import {
  calcPlanificadorShiftHours,
  isPlanificadorPlannedHoursShift,
} from '@/lib/planificacion/planningScheduledHours';
import type { SlaExclusionContext } from './slaExclusionForPlanned';
import { isTurnoOnSlaExcludedSlot } from './slaExclusionForPlanned';

export const CRM_PLANNED_SHIFT_HOURS: Record<string, number> = {
  M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, C: 8,
};

const NON_PLANNED_CODES = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA']);

export function isCrmWorkingShiftCode(code: string): boolean {
  return !NON_PLANNED_CODES.has((code || '').trim().toUpperCase());
}

/** Pie «Hs. Plan.» del planificador — excluye REF/ESC/RET, ops, vacantes y días/puestos excluidos SLA. */
export function isCrmPlannedEligibleShift(t: any, slaExclusion?: SlaExclusionContext): boolean {
  if (!isPlanificadorPlannedHoursShift(t)) return false;
  if (isProformaVacancyShift(t)) return false;
  if (slaExclusion && isTurnoOnSlaExcludedSlot(t, slaExclusion)) return false;
  return true;
}

export const toDateSafe = (val: any): Date | null => {
  if (!val) return null;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val?.seconds === 'number') return new Date(val.seconds * 1000);
  if (val instanceof Date) return val;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const getDurationHours = (start: Date, end: Date) => {
  const diff = (end.getTime() - start.getTime()) / 3600000;
  if (diff >= 0) return diff;
  return diff + 24;
};

export function resolveCrmPlannedShiftHours(t: any, _plannedStart?: Date, _plannedEnd?: Date): number {
  if (!isCrmPlannedEligibleShift(t)) return 0;
  return calcPlanificadorShiftHours(t);
}

export type PlannedHoursRange = { start: Date | null; end: Date | null };

export function shiftPlannedStartInRange(plannedStart: Date, range: PlannedHoursRange): boolean {
  const { start, end } = range;
  if (!start || !end) return true;
  return plannedStart >= start && plannedStart <= end;
}

export function objectiveIdsForClient(client: ClientRef): Set<string> {
  const ids = new Set<string>();
  for (const o of client.objetivos || []) {
    const id = String(o.id ?? '').trim();
    if (id) ids.add(id);
  }
  return ids;
}

export function turnoBelongsToObjective(t: any, objectiveId: string): boolean {
  const target = String(objectiveId).trim();
  if (!target) return false;
  const oid = String(t.objectiveId ?? '').trim();
  const oname = String(t.objectiveName ?? '').trim();
  return oid === target || oname === target;
}

function turnoMatchesAnyClientObjective(t: any, client: ClientRef): boolean {
  const objIds = objectiveIdsForClient(client);
  if (objIds.size === 0) return clientRowMatchesClient(t, client);
  for (const objId of objIds) {
    if (turnoBelongsToObjective(t, objId)) return true;
    const obj = (client.objetivos || []).find((o) => String(o.id ?? '').trim() === objId);
    const name = String(obj?.name ?? '').trim();
    if (name && turnoBelongsToObjective(t, name)) return true;
  }
  return false;
}

/** Una celda emp+día por objetivo (último turno gana, como shiftsMap del planificador). */
export function sumPlannedHoursForObjective(
  turnos: any[],
  objectiveId: string,
  range: PlannedHoursRange,
  slaExclusion?: SlaExclusionContext,
): number {
  const cells = new Map<string, number>();
  for (const t of turnos) {
    if (!turnoBelongsToObjective(t, objectiveId)) continue;
    if (!isCrmPlannedEligibleShift(t, slaExclusion)) continue;
    const plannedStart = toDateSafe(t.startTime);
    if (!plannedStart || !shiftPlannedStartInRange(plannedStart, range)) continue;
    const hrs = calcPlanificadorShiftHours(t);
    if (hrs <= 0) continue;
    const empId = String(t.employeeId || 'unknown');
    const dateKey = getDateKeyInTimezone(plannedStart);
    cells.set(`${empId}_${dateKey}`, hrs);
  }
  return [...cells.values()].reduce((a, b) => a + b, 0);
}

export function sumPlannedHoursForClient(
  turnos: any[],
  client: ClientRef,
  range: PlannedHoursRange,
  slaExclusion?: SlaExclusionContext,
): number {
  const cells = new Map<string, number>();
  for (const t of turnos) {
    if (!turnoMatchesAnyClientObjective(t, client)) continue;
    if (!isCrmPlannedEligibleShift(t, slaExclusion)) continue;
    const plannedStart = toDateSafe(t.startTime);
    if (!plannedStart || !shiftPlannedStartInRange(plannedStart, range)) continue;
    const hrs = calcPlanificadorShiftHours(t);
    if (hrs <= 0) continue;
    const objId = String(t.objectiveId || t.objectiveName || 'sin-obj');
    const empId = String(t.employeeId || 'unknown');
    const dateKey = getDateKeyInTimezone(plannedStart);
    cells.set(`${objId}_${empId}_${dateKey}`, hrs);
  }
  return [...cells.values()].reduce((a, b) => a + b, 0);
}

export function sumPlannedHoursForTurnos(turnos: any[], range: PlannedHoursRange): number {
  const cells = new Map<string, number>();
  for (const t of turnos) {
    if (!isCrmPlannedEligibleShift(t)) continue;
    const plannedStart = toDateSafe(t.startTime);
    if (!plannedStart || !shiftPlannedStartInRange(plannedStart, range)) continue;
    const hrs = calcPlanificadorShiftHours(t);
    if (hrs <= 0) continue;
    const objId = String(t.objectiveId || 'sin-obj');
    const empId = String(t.employeeId || 'unknown');
    const dateKey = getDateKeyInTimezone(plannedStart);
    cells.set(`${objId}_${empId}_${dateKey}`, hrs);
  }
  return [...cells.values()].reduce((a, b) => a + b, 0);
}

export function resolveClientIdForTurno(
  t: Record<string, unknown>,
  clients: ClientRef[],
): string | null {
  const direct = String(t.clientId ?? '').trim();
  if (direct) {
    const byId = clients.find((c) => c.id === direct);
    if (byId) return byId.id;
  }
  for (const c of clients) {
    if (clientRowMatchesClient(t, c)) return c.id;
  }
  return null;
}
