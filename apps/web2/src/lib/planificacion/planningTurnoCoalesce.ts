import { calcPlanningBillableShiftHours } from './planningScheduledHours';

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
