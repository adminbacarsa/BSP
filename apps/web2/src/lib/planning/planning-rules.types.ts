/** Reglas de planificación / CCT — espejo del backend (planning_rules/{empresaId}). */

export type PlanningCycleKey = '6+2' | '4+2' | '5+1' | '6+1';

export interface PlanningCycleRule {
  workDays: number;
  restDays: number;
  shiftHours: 8 | 12;
  enabled: boolean;
}

export interface PlanningRulesConfig {
  status: 'ACTIVE' | 'INACTIVE';
  updatedAt?: string;
  updatedBy?: string;
  cctMaxBillableHours: number;
  targetAvgHoursPerEmployee: number;
  minRestHoursBetweenBands: number;
  maxConsecutiveWorkHours: number;
  defaultCycle: PlanningCycleKey;
  cycles: Record<PlanningCycleKey, PlanningCycleRule>;
  solverMaxIterations: number;
  protectCoverageOnEnforce: boolean;
  slaHoursTolerance: number;
  coverageRatioMin: number;
}

export const PLANNING_CYCLE_KEYS: PlanningCycleKey[] = ['6+2', '4+2', '5+1', '6+1'];

export const DEFAULT_PLANNING_RULES: PlanningRulesConfig = {
  status: 'ACTIVE',
  cctMaxBillableHours: 200,
  targetAvgHoursPerEmployee: 192,
  minRestHoursBetweenBands: 8,
  maxConsecutiveWorkHours: 56,
  defaultCycle: '6+2',
  cycles: {
    '6+2': { workDays: 6, restDays: 2, shiftHours: 8, enabled: true },
    '4+2': { workDays: 4, restDays: 2, shiftHours: 12, enabled: true },
    '5+1': { workDays: 5, restDays: 1, shiftHours: 8, enabled: true },
    '6+1': { workDays: 6, restDays: 1, shiftHours: 8, enabled: true },
  },
  solverMaxIterations: 48,
  protectCoverageOnEnforce: true,
  slaHoursTolerance: 8,
  coverageRatioMin: 0.98,
};

export function mergePlanningRulesFromFirestore(
  raw: Partial<PlanningRulesConfig> | null | undefined,
): PlanningRulesConfig {
  const base = DEFAULT_PLANNING_RULES;
  if (!raw) return { ...base, cycles: { ...base.cycles } };
  const cycles = { ...base.cycles };
  for (const key of PLANNING_CYCLE_KEYS) {
    cycles[key] = { ...base.cycles[key], ...(raw.cycles?.[key] ?? {}) };
  }
  return {
    ...base,
    ...raw,
    cycles,
    defaultCycle: raw.defaultCycle ?? base.defaultCycle,
    status: raw.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    protectCoverageOnEnforce: raw.protectCoverageOnEnforce !== false,
  };
}
