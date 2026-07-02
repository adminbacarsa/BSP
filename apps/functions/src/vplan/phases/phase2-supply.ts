/**
 * Fase 2 VPLAN — modelo de oferta (dotación − ausencias).
 */

import type { VplanSupplyModel } from '../vplan.types';
import type { VplanEmployeeRecord } from '../vplan.firestore';

const HARD_MAX_CCT_HOURS = 200;

export function buildVplanSupplyModel(opts: {
  employees: VplanEmployeeRecord[];
  days: Array<{ dateStr: string }>;
  absences: Record<string, Set<string>>;
  suggestedHeadcount?: number;
  previousMonthStateKey?: string;
}): VplanSupplyModel {
  const monthDayCount = opts.days.length;

  const employees = opts.employees.map((emp) => {
    const blocked = opts.absences[emp.id] ?? new Set<string>();
    const blockedDates = [...blocked].sort();
    const availableDays = monthDayCount - blockedDates.length;
    const prior = Math.max(0, emp.priorCctHours);
    const cctHoursRemaining = Math.max(0, HARD_MAX_CCT_HOURS - prior);

    return {
      employeeId: emp.id,
      displayName: emp.displayName,
      blockedDates,
      availableDays,
      cctHoursUsed: prior,
      cctHoursRemaining,
    };
  });

  return {
    employeeCount: employees.length,
    employees,
    suggestedHeadcount: opts.suggestedHeadcount,
    previousMonthSnapshotId: opts.previousMonthStateKey,
  };
}

export function estimateOfferHours(
  supply: VplanSupplyModel,
  avgShiftHours = 8,
  workRatio = 6 / 7,
): number {
  return supply.employees.reduce((sum, emp) => {
    const workable = Math.max(0, emp.availableDays) * workRatio;
    const capByDays = Math.ceil(workable) * avgShiftHours;
    const capByCct = emp.cctHoursRemaining ?? HARD_MAX_CCT_HOURS;
    return sum + Math.min(capByDays, capByCct);
  }, 0);
}
