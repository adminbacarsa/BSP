import { clientRowMatchesClient, type ClientRef } from './clientDataMatch';
import { getDateKeyInTimezone, resolveTurnoScheduleDateKey, toDateSafe as toDateSafeCore } from './crmDateUtils';
import { isProformaVacancyShift } from './proformaVacancy';
import {
  calcPlanificadorShiftHours,
  isPlanificadorPlannedHoursShift,
} from '@/lib/planificacion/planningScheduledHours';
import { coalescePlannedTurnosForCell, coalescePlannedCellBillableHours } from '@/lib/planificacion/planningTurnoCoalesce';
import type { SlaExclusionContext } from './slaExclusionForPlanned';
import { isTurnoOnSlaExcludedSlot } from './slaExclusionForPlanned';
import type { SlaPlanningRow } from '@/lib/slaPlanningMatch';
import type { ServicePosition } from '@/services/slaService';

type SlaShiftVariant = { code?: string; hours?: number; startTime?: string; endTime?: string };

function parseClockToHours(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] + +m[2] / 60 : null;
}

function shiftVariantsFromPosition(pos: unknown): SlaShiftVariant[] {
  const raw = pos as ServicePosition & { shifts?: SlaShiftVariant[] };
  const list = raw.allowedShiftTypes ?? raw.shifts;
  return Array.isArray(list) ? list : [];
}

function applyShiftVariantToHint(hint: Record<string, number>, sh: SlaShiftVariant): void {
  const code = String(sh.code || '').trim().toUpperCase();
  if (!code) return;
  const n = Number(sh.hours);
  if (n > 0) {
    hint[code] = n;
    return;
  }
  if (typeof sh.startTime === 'string' && typeof sh.endTime === 'string') {
    const s = parseClockToHours(sh.startTime);
    const e = parseClockToHours(sh.endTime);
    if (s != null && e != null) {
      let dur = e - s;
      if (dur <= 0) dur += 24;
      if (dur > 0) hint[code] = dur;
    }
  }
}

function mergeSlaCodeHoursHints(
  services: SlaPlanningRow[],
  target: Record<string, number>,
): void {
  for (const srv of services) {
    const rawPositions = Array.isArray(srv.positions)
      ? srv.positions
      : Object.values((srv.positions as Record<string, unknown>) || {});
    for (const raw of rawPositions) {
      for (const sh of shiftVariantsFromPosition(raw)) {
        applyShiftVariantToHint(target, sh);
      }
    }
  }
}

/** Horas por código de turno desde SLA vigente (E1, E2, P4, N custom 9h, etc.). */
export function buildSlaCodeHoursHintFromServices(services: SlaPlanningRow[]): Record<string, number> {
  const hint: Record<string, number> = {};
  mergeSlaCodeHoursHints(services, hint);
  return hint;
}

/** Misma regla que buildSlaCodeHoursHintFromServices, pero por objectiveId (evita mezclar N 8h vs 9h entre sedes). */
export function buildSlaCodeHoursHintByObjectiveId(
  services: SlaPlanningRow[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const srv of services) {
    const objId = String(srv.objectiveId ?? '').trim();
    if (!objId) continue;
    const hint = out[objId] ?? (out[objId] = {});
    const rawPositions = Array.isArray(srv.positions)
      ? srv.positions
      : Object.values((srv.positions as Record<string, unknown>) || {});
    for (const raw of rawPositions) {
      for (const sh of shiftVariantsFromPosition(raw)) {
        applyShiftVariantToHint(hint, sh);
      }
    }
  }
  return out;
}

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
  if (slaExclusion) {
    const plannedStart = toDateSafeCore(t.startTime);
    const scheduleDateKey =
      resolveTurnoScheduleDateKey(t) || (plannedStart ? getDateKeyInTimezone(plannedStart) : undefined);
    if (
      isTurnoOnSlaExcludedSlot(t, slaExclusion, {
        scheduleDateKey,
        positionName: String(t.positionName ?? ''),
      })
    ) {
      return false;
    }
  }
  return true;
}

export const toDateSafe = toDateSafeCore;

export const getDurationHours = (start: Date, end: Date) => {
  const diff = (end.getTime() - start.getTime()) / 3600000;
  if (diff >= 0) return diff;
  return diff + 24;
};

export function resolveCrmPlannedShiftHours(
  t: any,
  _plannedStart?: Date,
  _plannedEnd?: Date,
  slaCodeHoursHint?: Record<string, number>,
  slaExclusion?: SlaExclusionContext,
): number {
  if (!isCrmPlannedEligibleShift(t, slaExclusion)) return 0;
  return calcPlanificadorShiftHours(t, slaCodeHoursHint);
}

function pushTurnoIntoPlanningCellGroups(
  groups: Map<string, any[]>,
  t: any,
  range: PlannedHoursRange,
  keyBuilder: (t: any, dateKey: string) => string,
): void {
  const plannedStart = toDateSafe(t.startTime);
  if (!plannedStart || !shiftPlannedStartInRange(plannedStart, range)) return;
  const dateKey = resolveTurnoScheduleDateKey(t) || getDateKeyInTimezone(plannedStart);
  const key = keyBuilder(t, dateKey);
  const list = groups.get(key) || [];
  list.push(t);
  groups.set(key, list);
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

export function sumPlannedHoursForObjective(
  turnos: any[],
  objectiveId: string,
  range: PlannedHoursRange,
  slaExclusion?: SlaExclusionContext,
  slaCodeHoursHint?: Record<string, number>,
): number {
  const groups = new Map<string, any[]>();
  for (const t of turnos) {
    if (!turnoBelongsToObjective(t, objectiveId)) continue;
    if (!isCrmPlannedEligibleShift(t, slaExclusion)) continue;
    pushTurnoIntoPlanningCellGroups(groups, t, range, (_t, dateKey) => {
      const empId = String(_t.employeeId || 'unknown');
      return `${empId}_${dateKey}`;
    });
  }
  let total = 0;
  for (const rows of groups.values()) {
    const hrs = coalescePlannedCellBillableHours(rows, slaCodeHoursHint);
    if (hrs > 0) total += hrs;
  }
  return total;
}

export function sumPlannedHoursForClient(
  turnos: any[],
  client: ClientRef,
  range: PlannedHoursRange,
  slaExclusion?: SlaExclusionContext,
  slaCodeHoursHint?: Record<string, number>,
  slaCodeHoursHintByObjective?: Record<string, Record<string, number>>,
): number {
  const groups = new Map<string, any[]>();
  for (const t of turnos) {
    if (!turnoMatchesAnyClientObjective(t, client)) continue;
    if (!isCrmPlannedEligibleShift(t, slaExclusion)) continue;
    pushTurnoIntoPlanningCellGroups(groups, t, range, (row, dateKey) => {
      const objId = String(row.objectiveId || row.objectiveName || 'sin-obj');
      const empId = String(row.employeeId || 'unknown');
      return `${objId}_${empId}_${dateKey}`;
    });
  }
  let total = 0;
  for (const rows of groups.values()) {
    const objId = String(rows[0]?.objectiveId ?? '').trim();
    const hint = (objId && slaCodeHoursHintByObjective?.[objId]) || slaCodeHoursHint;
    const hrs = coalescePlannedCellBillableHours(rows, hint);
    if (hrs > 0) total += hrs;
  }
  return total;
}

export function sumPlannedHoursForTurnos(turnos: any[], range: PlannedHoursRange, slaCodeHoursHint?: Record<string, number>): number {
  const groups = new Map<string, any[]>();
  for (const t of turnos) {
    if (!isCrmPlannedEligibleShift(t)) continue;
    pushTurnoIntoPlanningCellGroups(groups, t, range, (row, dateKey) => {
      const objId = String(row.objectiveId || 'sin-obj');
      const empId = String(row.employeeId || 'unknown');
      return `${objId}_${empId}_${dateKey}`;
    });
  }
  let total = 0;
  for (const rows of groups.values()) {
    const hrs = coalescePlannedCellBillableHours(rows, slaCodeHoursHint);
    if (hrs > 0) total += hrs;
  }
  return total;
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

/** Agrupa turnos por cliente canónico (una pasada). */
export function groupTurnosByClient(
  turnos: any[],
  clientRefs: ClientRef[],
  tenantClientIds?: Set<string>,
): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const c of clientRefs) {
    map.set(c.id, []);
  }
  for (const t of turnos) {
    const cid = resolveClientIdForTurno(t, clientRefs);
    if (!cid) continue;
    if (tenantClientIds && !tenantClientIds.has(cid)) continue;
    map.get(cid)?.push(t);
  }
  return map;
}
