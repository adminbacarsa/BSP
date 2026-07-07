import * as admin from 'firebase-admin';
import {
  DEFAULT_CYCLE_RULES,
  DEFAULT_PLANNING_RULES,
  normalizePlanningCycleKey,
  PLANNING_CYCLE_KEYS,
} from './planning-rules.defaults';
import type {
  PlanningCycleKey,
  PlanningCycleRule,
  PlanningRulesConfig,
  PlanningRulesStatus,
} from './planning-rules.types';

const db = () => admin.firestore();

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function mergeCycleRule(
  key: PlanningCycleKey,
  raw: Partial<PlanningCycleRule> | undefined,
): PlanningCycleRule {
  const base = DEFAULT_CYCLE_RULES[key];
  return {
    workDays: clampInt(raw?.workDays, 1, 12, base.workDays),
    restDays: clampInt(raw?.restDays, 1, 7, base.restDays),
    shiftHours: raw?.shiftHours === 12 ? 12 : 8,
    enabled: raw?.enabled !== false,
  };
}

/** Normaliza payload parcial (Firestore o API) sobre defaults CCT 422/05. */
export function resolvePlanningRules(raw?: Partial<PlanningRulesConfig> | null): PlanningRulesConfig {
  const cycles = {} as Record<PlanningCycleKey, PlanningCycleRule>;
  for (const key of PLANNING_CYCLE_KEYS) {
    cycles[key] = mergeCycleRule(key, raw?.cycles?.[key]);
  }

  const defaultCycle = normalizePlanningCycleKey(raw?.defaultCycle ?? DEFAULT_PLANNING_RULES.defaultCycle);
  const status: PlanningRulesStatus = raw?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

  return {
    status,
    updatedAt: raw?.updatedAt,
    updatedBy: raw?.updatedBy,
    cctMaxBillableHours: clampInt(
      raw?.cctMaxBillableHours,
      80,
      320,
      DEFAULT_PLANNING_RULES.cctMaxBillableHours,
    ),
    targetAvgHoursPerEmployee: clampInt(
      raw?.targetAvgHoursPerEmployee,
      120,
      240,
      DEFAULT_PLANNING_RULES.targetAvgHoursPerEmployee,
    ),
    minRestHoursBetweenBands: clampInt(
      raw?.minRestHoursBetweenBands,
      4,
      16,
      DEFAULT_PLANNING_RULES.minRestHoursBetweenBands,
    ),
    maxConsecutiveWorkHours: clampInt(
      raw?.maxConsecutiveWorkHours,
      24,
      96,
      DEFAULT_PLANNING_RULES.maxConsecutiveWorkHours,
    ),
    defaultCycle: cycles[defaultCycle]?.enabled ? defaultCycle : (
      PLANNING_CYCLE_KEYS.find((k) => cycles[k].enabled) ?? '6+2'
    ),
    cycles,
    solverMaxIterations: clampInt(
      raw?.solverMaxIterations,
      4,
      96,
      DEFAULT_PLANNING_RULES.solverMaxIterations,
    ),
    protectCoverageOnEnforce: raw?.protectCoverageOnEnforce !== false,
    slaHoursTolerance: clampInt(
      raw?.slaHoursTolerance,
      0,
      48,
      DEFAULT_PLANNING_RULES.slaHoursTolerance,
    ),
    coverageRatioMin: clampFloat(
      raw?.coverageRatioMin,
      0.9,
      1,
      DEFAULT_PLANNING_RULES.coverageRatioMin,
    ),
  };
}

export async function loadPlanningRulesForEmpresa(empresaId: string): Promise<PlanningRulesConfig> {
  const id = String(empresaId || '').trim();
  if (!id) return resolvePlanningRules(null);

  try {
    const snap = await db().collection('planning_rules').doc(id).get();
    if (!snap.exists) return resolvePlanningRules(null);
    const data = snap.data() as Partial<PlanningRulesConfig>;
    if (data.status === 'INACTIVE') return resolvePlanningRules(null);
    return resolvePlanningRules(data);
  } catch {
    return resolvePlanningRules(null);
  }
}

export function planningRulesDocPath(empresaId: string): string {
  return `planning_rules/${empresaId}`;
}
