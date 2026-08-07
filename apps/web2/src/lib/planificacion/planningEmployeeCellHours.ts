import { coalescePlannedCellBillableHours, coalescePlannedTurnosForCell } from '@/lib/planificacion/planningTurnoCoalesce';
import {
  calcPlanningSlaReconciliationHours,
  isOperationalOriginShift,
} from '@/lib/planificacion/planningScheduledHours';
import { shiftCountsForEmployeeCronoHours } from '@/lib/planificacion/deploymentRoles';

export type PlanningCellHoursContext = {
  selectedObjective: string | null | undefined;
  grupoObjectiveIds: string[] | null;
  slaCodeHoursHint?: Record<string, number>;
  isExcludedFromBillable: (shift: any, dateStr: string, shiftPos: string) => boolean;
  assignedPositionForEmp?: (empId: string) => string;
};

function turnoBelongsToPlanningContext(shift: any, ctx: PlanningCellHoursContext): boolean {
  if (!shift) return false;
  if (isOperationalOriginShift(shift)) return false;
  const ao = shift.objectiveId != null && shift.objectiveId !== '' ? String(shift.objectiveId) : '';
  if (ctx.grupoObjectiveIds) {
    if (!ao || !ctx.grupoObjectiveIds.includes(ao)) return false;
    return true;
  }
  if (!ctx.selectedObjective) return false;
  if (!ao) return true;
  return ao === String(ctx.selectedObjective);
}

/** Turnos guardados en Firestore para la celda, filtrados al objetivo/grupo activo. */
export function savedTurnosForPlanningCell(
  cellTurnos: any[] | undefined,
  ctx: PlanningCellHoursContext,
): any[] {
  if (!cellTurnos?.length) return [];
  return cellTurnos.filter((t) => turnoBelongsToPlanningContext(t, ctx));
}

function shiftPosForTurno(shift: any, empId: string, ctx: PlanningCellHoursContext): string {
  const fromEmp = ctx.assignedPositionForEmp?.(empId) || '';
  return String(shift.positionName || fromEmp || '').trim();
}

function eligibleBillableTurnosForCell(
  turnos: any[],
  dateStr: string,
  empId: string,
  ctx: PlanningCellHoursContext,
): any[] {
  return turnos.filter((t) => {
    if (!shiftCountsForEmployeeCronoHours(t)) return false;
    const shiftPos = shiftPosForTurno(t, empId, ctx);
    if (ctx.isExcludedFromBillable(t, dateStr, shiftPos)) return false;
    return true;
  });
}

/** Horas facturables de la celda (misma regla que pre-factura / proformaGrid). */
export function billableHoursForPlanningCell(
  turnos: any[],
  dateStr: string,
  empId: string,
  ctx: PlanningCellHoursContext,
): number {
  const eligible = eligibleBillableTurnosForCell(turnos, dateStr, empId, ctx);
  if (!eligible.length) return 0;
  return coalescePlannedCellBillableHours(eligible, ctx.slaCodeHoursHint);
}

export function slaBaseHoursForPlanningCell(
  turnos: any[],
  dateStr: string,
  empId: string,
  ctx: PlanningCellHoursContext,
): number {
  const eligible = eligibleBillableTurnosForCell(turnos, dateStr, empId, ctx);
  if (!eligible.length) return 0;
  const merged = coalescePlannedTurnosForCell(eligible, ctx.slaCodeHoursHint);
  if (!merged) return 0;
  return calcPlanningSlaReconciliationHours(merged, ctx.slaCodeHoursHint);
}

export function resolveTurnosForPlanningCellKey(params: {
  empId: string;
  dateStr: string;
  pending: any | undefined;
  cellTurnos: any[] | undefined;
  resolveSingleAtObjective: () => any | null;
  ctx: PlanningCellHoursContext;
}): any[] {
  const { pending, cellTurnos, resolveSingleAtObjective, ctx } = params;
  if (pending?.isDeleted) return [];
  if (pending && !pending.isDeleted) {
    if (!turnoBelongsToPlanningContext(pending, ctx)) return [];
    return [pending];
  }
  const saved = savedTurnosForPlanningCell(cellTurnos, ctx);
  if (saved.length > 0) return saved;
  const single = resolveSingleAtObjective();
  if (!single) return [];
  if (!turnoBelongsToPlanningContext(single, ctx)) return [];
  return [single];
}
