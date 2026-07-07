import type { PlanningCycleKey, PlanningCycleRule, PlanningRulesConfig } from './planning-rules.types';

export const PLANNING_CYCLE_KEYS: PlanningCycleKey[] = ['6+2', '4+2', '5+1', '6+1'];

export const DEFAULT_CYCLE_RULES: Record<PlanningCycleKey, PlanningCycleRule> = {
  '6+2': { workDays: 6, restDays: 2, shiftHours: 8, enabled: true },
  '4+2': { workDays: 4, restDays: 2, shiftHours: 12, enabled: true },
  '5+1': { workDays: 5, restDays: 1, shiftHours: 8, enabled: true },
  '6+1': { workDays: 6, restDays: 1, shiftHours: 8, enabled: true },
};

export const DEFAULT_PLANNING_RULES: PlanningRulesConfig = {
  status: 'ACTIVE',
  cctMaxBillableHours: 200,
  targetAvgHoursPerEmployee: 192,
  minRestHoursBetweenBands: 8,
  maxConsecutiveWorkHours: 56,
  defaultCycle: '6+2',
  cycles: { ...DEFAULT_CYCLE_RULES },
  solverMaxIterations: 48,
  protectCoverageOnEnforce: true,
  slaHoursTolerance: 8,
  coverageRatioMin: 0.98,
};

export function normalizePlanningCycleKey(cycle?: string): PlanningCycleKey {
  if (cycle === '4+2' || cycle === '5+1' || cycle === '6+1') return cycle;
  return '6+2';
}

export function enabledCyclesFromRules(rules: PlanningRulesConfig): PlanningCycleKey[] {
  return PLANNING_CYCLE_KEYS.filter((k) => rules.cycles[k]?.enabled !== false);
}

export function workDaysForCycle(cycle: string | undefined, rules: PlanningRulesConfig): number {
  const key = normalizePlanningCycleKey(cycle);
  return rules.cycles[key]?.workDays ?? DEFAULT_CYCLE_RULES[key].workDays;
}

export function restDaysForCycle(cycle: string | undefined, rules: PlanningRulesConfig): number {
  const key = normalizePlanningCycleKey(cycle);
  return rules.cycles[key]?.restDays ?? DEFAULT_CYCLE_RULES[key].restDays;
}

export function shiftHoursForCycle(cycle: string | undefined, rules: PlanningRulesConfig): 8 | 12 {
  const key = normalizePlanningCycleKey(cycle);
  return rules.cycles[key]?.shiftHours ?? DEFAULT_CYCLE_RULES[key].shiftHours;
}

export function isCycleEnabled(cycle: string | undefined, rules: PlanningRulesConfig): boolean {
  const key = normalizePlanningCycleKey(cycle);
  return rules.cycles[key]?.enabled !== false;
}
