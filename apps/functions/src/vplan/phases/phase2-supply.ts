/**
 * Fase 2 VPLAN — modelo de oferta (dotación − ausencias).
 */

import type { VplanSupplyModel } from '../vplan.types';
import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import { resolvePlanningRules } from '../../planning/planning-rules.service';
import type { VplanEmployeeRecord } from '../vplan.firestore';

export function buildVplanSupplyModel(opts: {
  employees: VplanEmployeeRecord[];
  days: Array<{ dateStr: string }>;
  absences: Record<string, Set<string>>;
  suggestedHeadcount?: number;
  previousMonthStateKey?: string;
  planningRules?: PlanningRulesConfig;
}): VplanSupplyModel {
  const rules = resolvePlanningRules(opts.planningRules ?? null);
  const cctMax = rules.cctMaxBillableHours;
  const monthDayCount = opts.days.length;

  const employees = opts.employees.map((emp) => {
    const blocked = opts.absences[emp.id] ?? new Set<string>();
    const blockedDates = [...blocked].sort();
    const availableDays = monthDayCount - blockedDates.length;
    const prior = Math.max(0, emp.priorCctHours);
    const cctHoursRemaining = Math.max(0, cctMax - prior);

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
  cctMaxFallback = 200,
): number {
  return supply.employees.reduce((sum, emp) => {
    const workable = Math.max(0, emp.availableDays) * workRatio;
    const capByDays = Math.ceil(workable) * avgShiftHours;
    const capByCct = emp.cctHoursRemaining ?? cctMaxFallback;
    return sum + Math.min(capByDays, capByCct);
  }, 0);
}
