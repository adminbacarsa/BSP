/**
 * Fase 8 VPLAN — ejecuta la acción del cerebro (3 mandatos básicos).
 */

import {
  runBrainMandateRepair,
  applyLightPositionTagFixes,
  type VplanBrainAction,
  type VplanBrainReport,
} from '../vplan.brain';
import { runCoverageSolverLoop } from '../vplan.coverage-solver';
import { protectedCellKey } from '../vplan.cycle-continuity';
import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import { resolvePlanningRules } from '../../planning/planning-rules.service';
import type { VplanExistingAssignment, VplanPlanningSnapshot, VplanPlanningState } from '../vplan.firestore';
import type { VplanPositionDef } from '../vplan.positions';
import type {
  VplanCoverageAuditReport,
  VplanDemandModel,
  VplanFixerLogEntry,
  VplanScheduleDraft,
  VplanStrategy,
} from '../vplan.types';

const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);

function applyCctHourCap(
  draft: VplanScheduleDraft,
  assignments: VplanScheduleDraft['assignments'],
  maxHours: number,
  protectedCells?: Set<string>,
): { assignments: VplanScheduleDraft['assignments']; log: VplanFixerLogEntry[] } {
  const log: VplanFixerLogEntry[] = [];
  const hoursByEmp: Record<string, number> = {};

  for (const a of assignments) {
    const code = a.code.toUpperCase();
    if (!BILLABLE.has(code)) continue;
    hoursByEmp[a.employeeId] = (hoursByEmp[a.employeeId] || 0) + (a.hours ?? 8);
  }

  const sorted = [...assignments].sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  const indexByKey = new Map<string, number>();
  assignments.forEach((a, i) => indexByKey.set(`${a.employeeId}_${a.dateStr}`, i));
  const next = assignments.map((a) => ({ ...a }));

  for (const a of sorted) {
    const code = a.code.toUpperCase();
    if (!BILLABLE.has(code)) continue;
    if (protectedCells?.has(protectedCellKey(a.employeeId, a.dateStr))) continue;
    const used = hoursByEmp[a.employeeId] || 0;
    if (used <= maxHours) continue;
    const idx = indexByKey.get(`${a.employeeId}_${a.dateStr}`);
    if (idx === undefined) continue;
    hoursByEmp[a.employeeId] = used - (a.hours ?? 8);
    next[idx] = { ...next[idx]!, code: 'F', hours: 0, positionName: '' };
    log.push({
      code: 'CCT_CAP',
      message: `Turno ${code} → F por tope ${maxHours}h ciclo`,
      employeeId: a.employeeId,
      dateStr: a.dateStr,
    });
  }

  return { assignments: next, log };
}

function runSolverFullFixer(
  draft: VplanScheduleDraft,
  dateStrs: string[],
  opts: {
    previousMonthAssignments?: VplanExistingAssignment[];
    positions?: VplanPositionDef[];
    dateMeta?: Array<{ dateStr: string; dayLetter: string }>;
    defaultPositionByEmp?: Record<string, string>;
    demand?: VplanDemandModel;
    cycle?: string;
    employeeNames?: Record<string, string>;
    planningRules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
  },
): {
  draft: VplanScheduleDraft;
  log: VplanFixerLogEntry[];
  coverageAudit?: VplanCoverageAuditReport;
} {
  const rules = resolvePlanningRules(opts.planningRules ?? null);
  const log: VplanFixerLogEntry[] = [];
  const cycle = opts.cycle ?? (draft.sourceEngine?.includes('4+2') ? '4+2' : '6+2');
  let coverageAudit: VplanCoverageAuditReport | undefined;
  const protectedCells = opts.protectedCells;

  let assignments = draft.assignments.map((a) => ({ ...a }));

  if (
    opts.demand
    && opts.positions?.length
    && opts.dateMeta?.length
    && dateStrs.length
    && opts.defaultPositionByEmp
  ) {
    const solved = runCoverageSolverLoop({
      draft: { ...draft, assignments },
      demand: opts.demand,
      positions: opts.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      dateStrs: opts.dateMeta,
      dateStrList: dateStrs,
      cycle,
      previousMonthAssignments: opts.previousMonthAssignments,
      employeeNames: opts.employeeNames,
      maxIterations: rules.solverMaxIterations,
      rules,
      protectedCells,
    });
    assignments = solved.draft.assignments;
    log.push(...solved.log);
    coverageAudit = solved.audit;
  }

  const capped = applyCctHourCap(draft, assignments, rules.cctMaxBillableHours, protectedCells);
  assignments = capped.assignments;
  log.push(...capped.log);

  return {
    draft: { ...draft, assignments },
    log,
    coverageAudit,
  };
}

export function runVplanDeterministicFixer(
  draft: VplanScheduleDraft,
  dateStrs?: string[],
  opts?: {
    brainReport?: VplanBrainReport;
    action?: VplanBrainAction;
    previousMonthAssignments?: VplanExistingAssignment[];
    monthFirstDate?: string;
    positions?: VplanPositionDef[];
    dateMeta?: Array<{ dateStr: string; dayLetter: string }>;
    defaultPositionByEmp?: Record<string, string>;
    defaultShiftByEmp?: Record<string, string>;
    demand?: VplanDemandModel;
    cycle?: string;
    strategy?: VplanStrategy;
    snapshot?: VplanPlanningSnapshot;
    prevPlanningState?: VplanPlanningState;
    prevMonthLastDate?: string;
    employeeNames?: Record<string, string>;
    planningRules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
  },
): {
  draft: VplanScheduleDraft;
  log: VplanFixerLogEntry[];
  coverageAudit?: VplanCoverageAuditReport;
  action: VplanBrainAction;
} {
  const action = opts?.action ?? opts?.brainReport?.action ?? 'solver_full';
  const summary = opts?.brainReport?.summary ?? action;
  const isPreserve = action === 'preserve' || action === 'mandate_repair';

  if (action === 'skip') {
    return {
      draft,
      log: [{ code: 'BRAIN_SKIP', message: summary }],
      action,
    };
  }

  if (isPreserve && opts?.brainReport && opts.demand && opts.positions && opts.dateMeta && opts.defaultPositionByEmp && opts.snapshot && opts.prevPlanningState && opts.strategy && opts.prevMonthLastDate && opts.monthFirstDate) {
    const repaired = runBrainMandateRepair({
      brain: opts.brainReport,
      draft,
      dateStrList: dateStrs ?? [],
      dateMeta: opts.dateMeta,
      demand: opts.demand,
      positions: opts.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      defaultShiftByEmp: opts.defaultShiftByEmp ?? {},
      cycle: opts.cycle ?? opts.strategy.cycle,
      strategy: opts.strategy,
      snapshot: opts.snapshot,
      prevPlanningState: opts.prevPlanningState,
      prevMonthLastDate: opts.prevMonthLastDate,
      monthFirstDate: opts.monthFirstDate,
      previousMonthAssignments: opts.previousMonthAssignments,
      employeeNames: opts.employeeNames,
      planningRules: opts.planningRules,
      protectedCells: opts.protectedCells,
    });
    return {
      draft: repaired.draft,
      log: repaired.log,
      coverageAudit: repaired.coverageAudit,
      action,
    };
  }

  if (isPreserve && opts?.defaultPositionByEmp) {
    const tagged = applyLightPositionTagFixes({
      draft,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      protectedCells: opts.protectedCells,
    });
    return {
      draft: tagged.draft,
      log: [{ code: 'BRAIN_REPAIR_FALLBACK', message: summary }, ...tagged.log],
      action,
    };
  }

  const full = runSolverFullFixer(draft, dateStrs ?? [], opts ?? {});
  return {
    ...full,
    log: [{ code: 'BRAIN_SOLVER_FULL', message: summary }, ...full.log],
    action: 'solver_full',
  };
}
