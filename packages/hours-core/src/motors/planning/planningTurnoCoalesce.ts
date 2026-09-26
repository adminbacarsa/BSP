import { calcPlanningBillableShiftHours } from './planningScheduledHours';

function turnoContributesCoverageMerge(t: any): boolean {
  if (!t) return false;
  if (t.isExtended || t.isEarlyStart) return true;
  const role = String(t.coverageSegmentRole || '').toUpperCase();
  if (role === 'EXTENSION' || role === 'EARLY_START') return true;
  const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
  return Number.isFinite(ex) && ex > 0;
}

/** Fusiona varios turnos del mismo emp/obj/día (p. ej. ext + base en docs distintos). */
export function coalescePlannedTurnosForCell(
  turnos: any[],
  slaCodeHoursHint?: Record<string, number>,
): any {
  if (!turnos.length) return null;
  if (turnos.length === 1) return turnos[0];
  let primary = turnos[0];
  let bestH = calcPlanningBillableShiftHours(primary, slaCodeHoursHint);
  for (const t of turnos) {
    const h = calcPlanningBillableShiftHours(t, slaCodeHoursHint);
    if (h > bestH) {
      primary = t;
      bestH = h;
    }
  }
  const merged: any = { ...primary };
  for (const t of turnos) {
    if (!turnoContributesCoverageMerge(t)) continue;
    merged.isExtended = merged.isExtended || t.isExtended;
    merged.isEarlyStart = merged.isEarlyStart || t.isEarlyStart;
    merged.coveragePackageId = merged.coveragePackageId || t.coveragePackageId;
    merged.coverageSegmentRole = merged.coverageSegmentRole || t.coverageSegmentRole;
    merged.coversPositionName = merged.coversPositionName || t.coversPositionName;
    merged.segmentFromTime = merged.segmentFromTime || t.segmentFromTime;
    merged.segmentToTime = merged.segmentToTime || t.segmentToTime;
    merged.adjustedEndTime = merged.adjustedEndTime || t.adjustedEndTime;
    merged.extensionEndTime = merged.extensionEndTime || t.extensionEndTime;
    merged.adjustedStartTime = merged.adjustedStartTime || t.adjustedStartTime;
    const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
    if (Number.isFinite(ex) && ex > 0) {
      merged.extExtraHours = Math.max(Number(merged.extExtraHours) || 0, ex);
    }
  }
  return merged;
}

/** Horas facturables de la celda sin contaminar el turno base con metadatos de docs fantasma. */
export function coalescePlannedCellBillableHours(
  turnos: any[],
  slaCodeHoursHint?: Record<string, number>,
): number {
  if (!turnos.length) return 0;
  const perTurno = turnos.map((t) => calcPlanningBillableShiftHours(t, slaCodeHoursHint));
  let maxH = 0;
  for (const h of perTurno) {
    if (h > maxH) maxH = h;
  }
  const merged = coalescePlannedTurnosForCell(turnos, slaCodeHoursHint);
  if (!merged) return Math.round(maxH * 100) / 100;
  const mergedH = calcPlanningBillableShiftHours(merged, slaCodeHoursHint);
  const splitCoverage = turnos.length > 1 && turnos.some(turnoContributesCoverageMerge);
  if (splitCoverage) {
    const sumH = perTurno.reduce((a, b) => a + b, 0);
    return Math.round(Math.max(mergedH, sumH) * 100) / 100;
  }
  return Math.round(Math.max(maxH, mergedH) * 100) / 100;
}
