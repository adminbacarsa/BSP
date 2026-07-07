/**
 * VPLAN — cerebro operativo.
 *
 * Modelo conceptual: ver vplan.brain-model.ts (3 capas + escalera).
 *
 * Mandatos (orden RÍGIDO):
 *  1. CICLO_6X2 — 6+2 innegociable + racha/trailing mes anterior
 *  2. COBERTURA_OBJETIVO — slots SLA cubiertos
 *  3. HORAS_VENDIDAS — cerrar horas SLA vendidas
 *
 * En CONTINUE: acción `preserve` — solo racha/tags + plan escalera;
 * NUNCA solver destructivo que rompa 6+2.
 */

import { verifyCoverage } from '../scheduling/autoScheduleEngine';
import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import { resolvePlanningRules } from '../planning/planning-rules.service';
import {
  buildFeasibilityHourOffer,
  computeHourHeadroom,
  describePlanningLayers,
  ladderMessage,
  maxWorkDaysForPlanningCycle,
  OBJECTIVE_CYCLE_DEFAULT,
  recommendCoverageLadderStep,
  type CoverageLadderRecommendation,
  type HourHeadroom,
  type PlanningLayerStatus,
} from './vplan.brain-model';
import { detectCrossMonthContinuityViolations,
  patchMonthOpeningContinuity,
} from './vplan.cycle-continuity';
import { detectCctStreakViolations } from './vplan.cct-enforce';
import { buildEngineContext } from './vplan.engine-bridge';
import { engineAssignmentsFromDraft } from './vplan.coverage-views';
import type { VplanExistingAssignment, VplanPlanningSnapshot, VplanPlanningState } from './vplan.firestore';
import type { VplanPositionDef } from './vplan.positions';
import { normBandCode } from './vplan.sla-enforce';
import type {
  VplanDemandModel,
  VplanFeasibilityReport,
  VplanFixerLogEntry,
  VplanRunMode,
  VplanScheduleDraft,
  VplanStrategy,
  VplanSupplyModel,
} from './vplan.types';

const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);

export type VplanMandateKey = 'CICLO_6X2' | 'COBERTURA_OBJETIVO' | 'HORAS_VENDIDAS';

/** @deprecated Usar preserve */
export type VplanBrainAction = 'skip' | 'preserve' | 'mandate_repair' | 'solver_full';

export interface VplanMandateStatus {
  key: VplanMandateKey;
  label: string;
  ok: boolean;
  summary: string;
}

export interface VplanBrainReport {
  mandates: VplanMandateStatus[];
  mandatesOk: number;
  mandatesTotal: number;
  allMandatesOk: boolean;
  action: VplanBrainAction;
  summary: string;
  preserveGeneration: boolean;
  repairTargets: VplanMandateKey[];
  /** Tres capas de planificación (no mezclar) */
  planningLayers: PlanningLayerStatus[];
  hourHeadroom: HourHeadroom;
  /** Huecos SLA con escalón sugerido (4+2 → sin turno → RET → FT) */
  coverageLadder: CoverageLadderRecommendation[];
  /** Rachas >6 días trab en el mes (violación 6+2) */
  inMonthStreakViolations: number;
  /** Rupturas cross-month (trailing) */
  crossMonthViolations: number;
}

export interface VplanBrainEvaluateOpts {
  mode: VplanRunMode;
  strategy: VplanStrategy;
  draft: VplanScheduleDraft;
  demand: VplanDemandModel;
  snapshot: VplanPlanningSnapshot;
  planningState: VplanPlanningState;
  prevPlanningState: VplanPlanningState;
  defaultPositionByEmp: Record<string, string>;
  defaultShiftByEmp: Record<string, string>;
  prevMonthLastDate: string;
  monthFirstDate: string;
  dateStrList?: string[];
  supply?: VplanSupplyModel;
  feasibility?: VplanFeasibilityReport;
  planningRules?: PlanningRulesConfig;
}

function mandateCiclo6x2(opts: {
  strategy: VplanStrategy;
  draft: VplanScheduleDraft;
  snapshot: VplanPlanningSnapshot;
  prevPlanningState: VplanPlanningState;
  defaultPositionByEmp: Record<string, string>;
  prevMonthLastDate: string;
  monthFirstDate: string;
  dateStrList: string[];
  cycle: string;
  rules: PlanningRulesConfig;
}): {
  status: VplanMandateStatus;
  crossMonthViolations: number;
  inMonthStreakViolations: number;
} {
  const maxWork = maxWorkDaysForPlanningCycle(opts.cycle, opts.rules);
  const cctStreaks = detectCctStreakViolations({
    draft: opts.draft,
    dateStrs: opts.dateStrList,
    cycle: opts.cycle,
    previousMonthAssignments: opts.snapshot.previousMonthAssignments,
    rules: opts.rules,
  });

  let crossMonth: ReturnType<typeof detectCrossMonthContinuityViolations> = [];
  if (opts.strategy.modes.useTrailing && opts.prevMonthLastDate && opts.monthFirstDate) {
    crossMonth = detectCrossMonthContinuityViolations({
      draft: opts.draft,
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      prevMonthLastDate: opts.prevMonthLastDate,
      monthFirstDate: opts.monthFirstDate,
      prevPlanningState: opts.prevPlanningState,
      positions: opts.snapshot.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      cycle: opts.strategy.cycle,
    });
  }

  const ok = cctStreaks.length === 0 && crossMonth.length === 0;
  const parts: string[] = [];
  if (cctStreaks.length > 0) {
    parts.push(`${cctStreaks.length} racha(s) >${maxWork}d CCT`);
  }
  if (crossMonth.length > 0) {
    parts.push(`${crossMonth.length} ruptura(s) cross-month`);
  }

  return {
    status: {
      key: 'CICLO_6X2',
      label: 'Ciclo 6+2 + racha',
      ok,
      summary: ok
        ? `6+2 OK (máx ${maxWork} trab consecutivos)`
        : parts.join(' · '),
    },
    crossMonthViolations: crossMonth.length,
    inMonthStreakViolations: cctStreaks.length,
  };
}

function mandateHorasVendidas(
  billable: number,
  slaVendidas: number,
  tolerance: number,
  motorClosed: boolean,
): VplanMandateStatus {
  const target = slaVendidas > 0 ? slaVendidas : 0;
  const gap = target > 0 ? target - billable : 0;
  const ok = target <= 0
    || billable >= target - tolerance
    || (motorClosed && gap <= tolerance);

  return {
    key: 'HORAS_VENDIDAS',
    label: 'Horas vendidas',
    ok,
    summary: target > 0
      ? (ok ? `${billable}h / ${target}h SLA` : `Faltan ${Math.max(0, gap)}h (${billable}h / ${target}h)`)
      : `${billable}h facturables`,
  };
}

function mandateCobertura(uncovered: number, covered: number, total: number): VplanMandateStatus {
  const ok = uncovered <= 0 && total > 0;
  return {
    key: 'COBERTURA_OBJETIVO',
    label: 'Cobertura objetivo',
    ok,
    summary: ok
      ? `${covered}/${total} slots cubiertos`
      : `${uncovered} slot(s) descubierto(s) (${covered}/${total})`,
  };
}

function planCoverageLadder(opts: {
  uncoveredByDay: Record<string, Array<{ positionName: string; shiftCode: string; missing: number }>>;
  hourHeadroom: HourHeadroom;
  supply?: VplanSupplyModel;
}): CoverageLadderRecommendation[] {
  const recs: CoverageLadderRecommendation[] = [];
  const hasRet = (opts.supply?.employees?.length ?? 0) > 0;
  const hasPool = (opts.supply?.employeeCount ?? 0) > 0;

  for (const [dateStr, gaps] of Object.entries(opts.uncoveredByDay)) {
    for (const gap of gaps) {
      for (let m = 0; m < gap.missing; m++) {
        const step = recommendCoverageLadderStep({
          hourHeadroom: opts.hourHeadroom,
          hasRetAvailable: hasRet,
          hasUnassignedPool: hasPool,
        });
        const ladderIdx = step === 'REFUERZO_4X2_OBJETIVO' ? 2
          : step === 'SIN_TURNO_OBJETIVO' ? 3
            : step === 'RET_OBJETIVO' ? 4
              : step === 'FT_FRANCO_TRABAJADO' ? 5
                : 1;

        recs.push({
          dateStr,
          positionName: gap.positionName,
          shiftCode: gap.shiftCode,
          ladderStep: step,
          stepNumber: ladderIdx,
          message: ladderMessage(step, dateStr, gap.positionName, gap.shiftCode),
        });
      }
    }
  }

  return recs;
}

function countTrailingEmployees(draft: VplanScheduleDraft): number {
  const protectedKeys = draft.stats?.openingProtectedCells;
  if (protectedKeys?.length) {
    const emps = new Set(protectedKeys.map((k) => k.split('_')[0]).filter(Boolean));
    return emps.size;
  }
  return 0;
}

/**
 * Evalúa mandatos en orden: CICLO_6X2 → COBERTURA → HORAS.
 */
export function evaluateVplanBrainMandates(opts: VplanBrainEvaluateOpts): VplanBrainReport {
  const rules = resolvePlanningRules(opts.planningRules ?? null);
  const tolerance = rules.slaHoursTolerance ?? 8;
  const dateStrList = opts.dateStrList?.length
    ? opts.dateStrList
    : [...new Set(opts.draft.assignments.map((a) => a.dateStr))].sort();

  const ctx = buildEngineContext({
    snapshot: opts.snapshot,
    planningState: opts.planningState,
    prevPlanningState: opts.prevPlanningState,
    strategy: opts.strategy,
  });
  const engineAssignments = engineAssignmentsFromDraft(opts.draft.assignments);
  const coverage = verifyCoverage(ctx, engineAssignments);

  const ciclo = mandateCiclo6x2({
    strategy: opts.strategy,
    draft: opts.draft,
    snapshot: opts.snapshot,
    prevPlanningState: opts.prevPlanningState,
    defaultPositionByEmp: opts.defaultPositionByEmp,
    prevMonthLastDate: opts.prevMonthLastDate,
    monthFirstDate: opts.monthFirstDate,
    dateStrList,
    cycle: opts.strategy.cycle,
    rules,
  });
  const cobertura = mandateCobertura(
    coverage.uncoveredSlots,
    coverage.coveredSlots,
    coverage.totalSlots,
  );
  const horas = mandateHorasVendidas(
    Math.round(coverage.billableHours),
    coverage.slaVendidas,
    tolerance,
    opts.draft.stats?.slaHoursClosed === true,
  );

  const offerHours = buildFeasibilityHourOffer(opts.demand, opts.supply, opts.feasibility);
  const employeeCount = opts.supply?.employeeCount ?? opts.snapshot.employees.length;
  const hourHeadroom = computeHourHeadroom({
    slaVendidas: coverage.slaVendidas,
    billableHours: Math.round(coverage.billableHours),
    offerHours,
    tolerance,
    employeeCount,
    targetAvgHoursPerEmployee: rules.targetAvgHoursPerEmployee,
  });

  const planningLayers = describePlanningLayers({
    objectiveCycle: opts.strategy.cycle || OBJECTIVE_CYCLE_DEFAULT,
    useTrailing: !!opts.strategy.modes.useTrailing,
    trailingEmployeeCount: countTrailingEmployees(opts.draft),
    hourHeadroom,
  });

  const coverageLadder = planCoverageLadder({
    uncoveredByDay: coverage.uncoveredByDay ?? {},
    hourHeadroom,
    supply: opts.supply,
  });

  const mandates = [ciclo.status, cobertura, horas];
  const mandatesOk = mandates.filter((m) => m.ok).length;
  const allMandatesOk = mandatesOk === mandates.length;
  const repairTargets = mandates.filter((m) => !m.ok).map((m) => m.key);

  let action: VplanBrainAction;
  let preserveGeneration = false;
  let summary: string;

  if (allMandatesOk) {
    action = 'skip';
    preserveGeneration = true;
    summary = `3/3 mandatos OK — preservar generación`;
  } else if (
    opts.mode === 'GREENFIELD'
    || opts.mode === 'MIGRATE_CYCLE'
    || opts.mode === 'REBALANCE_HOURS'
    || opts.mode === 'RESTORE'
    || opts.mode === 'REPLAN_ABSENCES'
  ) {
    action = 'solver_full';
    summary = `${mandatesOk}/3 mandatos · modo ${opts.mode} → solver completo`;
  } else {
    action = 'preserve';
    preserveGeneration = opts.mode === 'CONTINUE';
    const ladderNote = coverageLadder.length > 0
      ? ` · escalera: ${coverageLadder.length} hueco(s)`
      : '';
    summary = `${mandatesOk}/3 mandatos · preservar + plan contingencia: ${repairTargets.join(', ')}${ladderNote}`;
  }

  return {
    mandates,
    mandatesOk,
    mandatesTotal: mandates.length,
    allMandatesOk,
    action,
    summary,
    preserveGeneration,
    repairTargets,
    planningLayers,
    hourHeadroom,
    coverageLadder,
    inMonthStreakViolations: ciclo.inMonthStreakViolations,
    crossMonthViolations: ciclo.crossMonthViolations,
  };
}

export function applyLightPositionTagFixes(opts: {
  draft: VplanScheduleDraft;
  defaultPositionByEmp: Record<string, string>;
  protectedCells?: Set<string>;
}): { draft: VplanScheduleDraft; log: VplanFixerLogEntry[] } {
  const log: VplanFixerLogEntry[] = [];
  const assignments = opts.draft.assignments.map((a) => ({ ...a }));

  for (let i = 0; i < assignments.length; i++) {
    const cell = assignments[i]!;
    const code = String(cell.code || '').toUpperCase();
    if (!WORK_CODES.has(code)) continue;

    const key = `${cell.employeeId}_${cell.dateStr}`;
    if (opts.protectedCells?.has(key)) continue;

    const expected = String(opts.defaultPositionByEmp[cell.employeeId] || '').trim();
    if (!expected) continue;

    const tagged = String(cell.positionName || '').trim();
    if (tagged === expected) continue;

    assignments[i] = { ...cell, positionName: expected };
    log.push({
      code: 'POSITION_TAG',
      message: tagged
        ? `Tag ${normBandCode(code)}: ${tagged} → ${expected} (${cell.dateStr})`
        : `Tag ${normBandCode(code)} → ${expected} (${cell.dateStr})`,
      employeeId: cell.employeeId,
      dateStr: cell.dateStr,
    });
  }

  return { draft: { ...opts.draft, assignments }, log };
}

export interface VplanBrainRepairOpts {
  brain: VplanBrainReport;
  draft: VplanScheduleDraft;
  dateStrList: string[];
  dateMeta: Array<{ dateStr: string; dayLetter: string }>;
  demand: VplanDemandModel;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  defaultShiftByEmp: Record<string, string>;
  cycle: string;
  strategy: VplanStrategy;
  snapshot: VplanPlanningSnapshot;
  prevPlanningState: VplanPlanningState;
  prevMonthLastDate: string;
  monthFirstDate: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  employeeNames?: Record<string, string>;
  planningRules?: PlanningRulesConfig;
  protectedCells?: Set<string>;
}

/**
 * Reparación en modo CONTINUE: solo racha + tags + log escalera.
 * NO invoca solver destructivo (evita F→turno que rompe 6+2).
 */
export function runBrainMandateRepair(opts: VplanBrainRepairOpts): {
  draft: VplanScheduleDraft;
  log: VplanFixerLogEntry[];
  coverageAudit?: import('./vplan.types').VplanCoverageAuditReport;
} {
  const log: VplanFixerLogEntry[] = [{ code: 'BRAIN_PRESERVE', message: opts.brain.summary }];
  let draft = opts.draft;

  if (opts.brain.repairTargets.includes('CICLO_6X2') && opts.strategy.modes.useTrailing) {
    const patched = patchMonthOpeningContinuity({
      draft,
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      prevMonthLastDate: opts.prevMonthLastDate,
      monthFirstDate: opts.monthFirstDate,
      prevPlanningState: opts.prevPlanningState,
      positions: opts.snapshot.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      defaultShiftByEmp: opts.defaultShiftByEmp,
      cycle: opts.cycle,
      useTrailing: true,
    });
    draft = patched.draft;
    log.push(...patched.log);
  }

  for (const layer of opts.brain.planningLayers) {
    log.push({
      code: 'BRAIN_LAYER',
      message: `[${layer.key}] ${layer.value} — ${layer.notes}`,
    });
  }

  if (opts.brain.hourHeadroom.assignmentGapNotHeadcount) {
    log.push({
      code: 'BRAIN_CAPACITY',
      message: opts.brain.hourHeadroom.summary,
    });
  }

  log.push({
    code: 'BRAIN_HEADROOM',
    message: opts.brain.hourHeadroom.summary,
  });

  for (const rec of opts.brain.coverageLadder) {
    log.push({
      code: rec.ladderStep === 'FT_FRANCO_TRABAJADO' ? 'NEEDS_REINFORCEMENT' : 'BRAIN_LADDER',
      message: `[paso ${rec.stepNumber}] ${rec.message}`,
      dateStr: rec.dateStr,
    });
  }

  if (opts.brain.inMonthStreakViolations > 0) {
    log.push({
      code: 'CICLO_6X2_VIOLATION',
      message: `${opts.brain.inMonthStreakViolations} racha(s) >6d — no forzar 7º día; revisar fase 5`,
    });
  }

  const tagged = applyLightPositionTagFixes({
    draft,
    defaultPositionByEmp: opts.defaultPositionByEmp,
    protectedCells: opts.protectedCells,
  });
  draft = tagged.draft;
  log.push(...tagged.log);

  return { draft, log };
}
