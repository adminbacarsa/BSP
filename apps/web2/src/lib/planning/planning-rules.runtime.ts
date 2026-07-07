import {
  DEFAULT_PLANNING_RULES,
  PLANNING_CYCLE_KEYS,
  type PlanningCycleKey,
  type PlanningRulesConfig,
} from './planning-rules.types';

export function planningHourLimits(rules?: PlanningRulesConfig | null) {
  const r = rules ?? DEFAULT_PLANNING_RULES;
  return {
    weekly: 48,
    monthly: r.cctMaxBillableHours,
    targetAvg: r.targetAvgHoursPerEmployee,
  };
}

export function enabledPlanningCycles(rules?: PlanningRulesConfig | null): PlanningCycleKey[] {
  const r = rules ?? DEFAULT_PLANNING_RULES;
  const enabled = PLANNING_CYCLE_KEYS.filter((key) => r.cycles[key]?.enabled !== false);
  return enabled.length > 0 ? enabled : [r.defaultCycle];
}

export function isPlanningCycleEnabled(
  cycle: string,
  rules?: PlanningRulesConfig | null,
): boolean {
  const key = cycle as PlanningCycleKey;
  if (!PLANNING_CYCLE_KEYS.includes(key)) return false;
  const r = rules ?? DEFAULT_PLANNING_RULES;
  return r.cycles[key]?.enabled !== false;
}
