import { clientRowMatchesClient, type ClientRef } from './clientDataMatch';
import { getDateKeyInTimezone, isProformaVacancyShift } from './proformaGrid';
import { shiftCountsForEmployeeCronoHours } from '@/lib/planificacion/deploymentRoles';
import {
  calcPlanningScheduledShiftHours,
  isPlanningScheduledCoverageShift,
} from '@/lib/planificacion/planningScheduledHours';

export const CRM_PLANNED_SHIFT_HOURS: Record<string, number> = {
  M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, C: 8,
};

const NON_PLANNED_CODES = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA']);

export function isCrmWorkingShiftCode(code: string): boolean {
  return !NON_PLANNED_CODES.has((code || '').trim().toUpperCase());
};

/** Alias histórico — misma regla que pie «Hs. Plan.» del planificador. */
export function isCrmPlannedEligibleShift(t: any): boolean {
  if (!isPlanningScheduledCoverageShift(t)) return false;
  if (isProformaVacancyShift(t)) return false;
  return shiftCountsForEmployeeCronoHours(t);
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
  return calcPlanningScheduledShiftHours(t);
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
    const name = String(o.name ?? '').trim();
    if (id) ids.add(id);
    if (name) ids.add(name);
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

/** Una celda emp+día por objetivo (último turno gana, como shiftsMap del planificador). */
export function sumPlannedHoursForObjective(
  turnos: any[],
  objectiveId: string,
  range: PlannedHoursRange,
): number {
  const cells = new Map<string, number>();
  for (const t of turnos) {
    if (!turnoBelongsToObjective(t, objectiveId)) continue;
    if (!isCrmPlannedEligibleShift(t)) continue;
    const plannedStart = toDateSafe(t.startTime);
    if (!plannedStart || !shiftPlannedStartInRange(plannedStart, range)) continue;
    const hrs = calcPlanningScheduledShiftHours(t);
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
): number {
  const objIds = objectiveIdsForClient(client);
  if (objIds.size === 0) {
    return sumPlannedHoursForTurnos(
      turnos.filter((t) => clientRowMatchesClient(t, client)),
      range,
    );
  }
  let total = 0;
  for (const objId of objIds) {
    total += sumPlannedHoursForObjective(turnos, objId, range);
  }
  return total;
}

export function sumPlannedHoursForTurnos(turnos: any[], range: PlannedHoursRange): number {
  const cells = new Map<string, number>();
  for (const t of turnos) {
    if (!isCrmPlannedEligibleShift(t)) continue;
    const plannedStart = toDateSafe(t.startTime);
    if (!plannedStart || !shiftPlannedStartInRange(plannedStart, range)) continue;
    const hrs = calcPlanningScheduledShiftHours(t);
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
