/**
 * Puente VPLAN → motor 6+2 embebido en Functions (scheduling/autoScheduleEngine).
 * Aislado del front V2/V4; misma lógica que runAutoSchedule.
 */

import type {
  EngineAssignment,
  EngineContext,
  EngineEmployeeDef,
  EnginePositionDef,
} from '../scheduling/autoScheduleEngine';
import type { VplanPlanningSnapshot, VplanPlanningState } from './vplan.firestore';
import type { VplanPositionDef } from './vplan.positions';
import type { VplanStrategy } from './vplan.types';

export function toEnginePositions(positions: VplanPositionDef[]): EnginePositionDef[] {
  return positions.map((p) => ({
    positionName: p.positionName,
    qty: p.qty,
    shifts: p.shifts.map((s) => ({
      code: s.code,
      hours: s.hours,
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    activeDays: p.activeDays,
    coverageType: p.coverageType,
  }));
}

export function buildCodeHoursHint(positions: VplanPositionDef[]): Record<string, number> {
  const hint: Record<string, number> = {};
  for (const p of positions) {
    for (const s of p.shifts) {
      if (s.code && s.hours > 0) hint[s.code] = s.hours;
    }
  }
  return hint;
}

export function buildEngineContext(opts: {
  snapshot: VplanPlanningSnapshot;
  planningState: VplanPlanningState;
  prevPlanningState: VplanPlanningState;
  strategy: VplanStrategy;
  cctCutoffDay?: number;
}): EngineContext {
  const daysInMonth = opts.snapshot.days.map((d) => {
    const [y, m, day] = d.dateStr.split('-').map(Number);
    return new Date(y, m - 1, day, 12, 0, 0);
  });

  const employees: EngineEmployeeDef[] = opts.snapshot.employees.map((e) => ({
    id: e.id,
    nombre: e.displayName,
  }));

  const useTrailing = opts.strategy.modes.useTrailing;

  return {
    positions: toEnginePositions(opts.snapshot.positions),
    employees,
    daysInMonth,
    slaVendidas: opts.snapshot.slaVendidas,
    autoCycles: [opts.strategy.cycle],
    absences: opts.snapshot.absences,
    defaultPositionByEmp: { ...opts.planningState.defaultPositionByEmp },
    defaultShiftByEmp: { ...opts.planningState.defaultShiftByEmp },
    prevMonthTrailingWorkDays: useTrailing ? opts.prevPlanningState.trailingWorkDays : undefined,
    prevMonthTrailingRestDays: useTrailing ? opts.prevPlanningState.trailingRestDays : undefined,
    prevMonthLastShiftByEmp: useTrailing ? opts.prevPlanningState.lastShiftByEmp : undefined,
    prevMonthLastWorkBandBeforeRest: useTrailing ? opts.prevPlanningState.lastWorkBandBeforeRest : undefined,
    cctCutoffDay: opts.cctCutoffDay ?? 25,
    codeHoursHint: buildCodeHoursHint(opts.snapshot.positions),
  };
}

export function engineToVplanAssignments(assignments: EngineAssignment[]): Array<{
  employeeId: string;
  dateStr: string;
  code: string;
  positionName: string;
  hours?: number;
}> {
  return assignments.map((a) => ({
    employeeId: a.empId,
    dateStr: a.dateStr,
    code: a.code,
    positionName: a.positionName,
    hours: a.hours,
  }));
}
