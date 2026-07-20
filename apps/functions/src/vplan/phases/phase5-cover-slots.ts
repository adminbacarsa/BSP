/**
 * VPLAN Fase 5 — cierre de cobertura slot a slot desde demanda SLA.
 * Toma el manifiesto (418 turnos/slot) y asigna guardias hasta agotar huecos legales.
 */

import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import { resolvePlanningRules } from '../../planning/planning-rules.service';
import { buildDetailedCoverageAudit } from '../vplan.coverage-audit';
import { fillAssignableGapsFromAudit, fillCoverageGapsWithLadder } from '../vplan.coverage-ladder';
import { countFilledSlotsFromAssignments } from '../vplan.coverage-manifest';
import type { VplanExistingAssignment } from '../vplan.firestore';
import type { VplanPositionDef } from '../vplan.positions';
import { stripExcessSlaAssignments } from '../vplan.sla-enforce';
import type {
  VplanAssignment,
  VplanCoverageManifest,
  VplanDemandModel,
  VplanFixerLogEntry,
  VplanScheduleDraft,
  VplanSlotCoverageResult,
} from '../vplan.types';

const MAX_COVERAGE_ITERATIONS = 10;

export function runVplanSlotCoverage(opts: {
  draft: VplanScheduleDraft;
  demand: VplanDemandModel;
  manifest: VplanCoverageManifest;
  dateStrs: Array<{ dateStr: string; dayLetter: string }>;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  cycle: string;
  dateStrList: string[];
  previousMonthAssignments?: VplanExistingAssignment[];
  slaVendidas: number;
  offerHours: number;
  employeeIds: string[];
  rules?: PlanningRulesConfig;
  protectedCells?: Set<string>;
  openingSlotByEmp?: Record<string, number>;
  defaultShiftByEmp?: Record<string, string>;
  useTrailing?: boolean;
  trailingEmployeeIds?: string[];
  excludeCustomCrossPool?: boolean;
  allowFrancoTrabajado?: boolean;
}): VplanSlotCoverageResult {
  const log: VplanFixerLogEntry[] = [];
  const rules = resolvePlanningRules(opts.rules ?? null);
  let assignments = opts.draft.assignments.map((a) => ({ ...a }));

  const ladderTotals = {
    subgrupo6x2: 0,
    refuerzo4x2: 0,
    sinTurno: 0,
    ret: 0,
    ft: 0,
    needsReinforcement: 0,
    bandSwap: 0,
    auditGap: 0,
  };

  let iterations = 0;
  let lastMissing = opts.manifest.totalRequiredSlots;
  let lastExcess = 0;

  for (let pass = 0; pass < MAX_COVERAGE_ITERATIONS; pass += 1) {
    iterations = pass + 1;

    const auditBefore = buildDetailedCoverageAudit({
      draft: { ...opts.draft, assignments },
      demand: opts.demand,
      positions: opts.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      dateStrs: opts.dateStrList,
      cycle: opts.cycle,
      previousMonthAssignments: opts.previousMonthAssignments,
      rules,
    });
    lastMissing = auditBefore.totalMissingSlots;
    lastExcess = auditBefore.totalExcessSlots;

    if (lastMissing === 0 && lastExcess === 0) break;

    const ladder = fillCoverageGapsWithLadder({
      draft: { ...opts.draft, assignments },
      dateStrs: opts.dateStrs,
      positions: opts.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      cycle: opts.cycle,
      dateStrList: opts.dateStrList,
      previousMonthAssignments: opts.previousMonthAssignments,
      slaVendidas: opts.slaVendidas,
      offerHours: opts.offerHours,
      employeeIds: opts.employeeIds,
      rules,
      protectedCells: opts.protectedCells,
      openingSlotByEmp: opts.openingSlotByEmp,
      defaultShiftByEmp: opts.defaultShiftByEmp,
      useTrailing: opts.useTrailing,
      trailingEmployeeIds: opts.trailingEmployeeIds,
      excludeCustomCrossPool: opts.excludeCustomCrossPool,
      allowFrancoTrabajado: opts.allowFrancoTrabajado ?? true,
    });
    assignments = ladder.draft.assignments;
    log.push(...ladder.log);
    ladderTotals.subgrupo6x2 += ladder.ladderStats.subgrupo6x2;
    ladderTotals.refuerzo4x2 += ladder.ladderStats.refuerzo4x2;
    ladderTotals.sinTurno += ladder.ladderStats.sinTurno;
    ladderTotals.ret += ladder.ladderStats.ret;
    ladderTotals.ft += ladder.ladderStats.ft;
    ladderTotals.needsReinforcement += ladder.ladderStats.needsReinforcement;
    ladderTotals.bandSwap += ladder.ladderStats.bandSwap ?? 0;
    ladderTotals.auditGap += ladder.ladderStats.auditGap ?? 0;

    const auditFill = fillAssignableGapsFromAudit({
      draft: { ...opts.draft, assignments },
      demand: opts.demand,
      positions: opts.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      dateStrList: opts.dateStrList,
      cycle: opts.cycle,
      previousMonthAssignments: opts.previousMonthAssignments,
      rules,
      protectedCells: opts.protectedCells,
      allowFrancoTrabajado: opts.allowFrancoTrabajado ?? true,
    });
    assignments = auditFill.draft.assignments;
    log.push(...auditFill.log);
    ladderTotals.auditGap += auditFill.ladderStats.auditGap ?? 0;

    const stripped = stripExcessSlaAssignments({
      draft: { ...opts.draft, assignments },
      dateStrs: opts.dateStrs,
      positions: opts.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      protectedCells: opts.protectedCells,
    });
    assignments = stripped.draft.assignments;
    log.push(...stripped.log);

    const auditAfter = buildDetailedCoverageAudit({
      draft: { ...opts.draft, assignments },
      demand: opts.demand,
      positions: opts.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      dateStrs: opts.dateStrList,
      cycle: opts.cycle,
      previousMonthAssignments: opts.previousMonthAssignments,
      rules,
    });

    if (
      auditAfter.totalMissingSlots === lastMissing
      && auditAfter.totalExcessSlots === lastExcess
      && ladder.log.length === 0
      && auditFill.log.length === 0
      && stripped.log.length === 0
    ) {
      lastMissing = auditAfter.totalMissingSlots;
      lastExcess = auditAfter.totalExcessSlots;
      break;
    }

    lastMissing = auditAfter.totalMissingSlots;
    lastExcess = auditAfter.totalExcessSlots;
    if (lastMissing === 0 && lastExcess === 0) break;
  }

  const progress = countFilledSlotsFromAssignments({
    assignments,
    defaultPositionByEmp: opts.defaultPositionByEmp,
    manifest: opts.manifest,
  });

  const ok = lastMissing === 0 && lastExcess === 0;

  return {
    draft: { ...opts.draft, assignments },
    log,
    ok,
    iterations,
    totalRequired: opts.manifest.totalRequiredSlots,
    filledSlots: progress.filledSlots,
    missingSlots: lastMissing,
    excessSlots: lastExcess,
    byPosition: progress.byPosition,
    ladderStats: ladderTotals,
    summaryLabel: ok
      ? `${progress.filledSlots}/${opts.manifest.totalRequiredSlots} turnos/slot cubiertos`
      : `${progress.filledSlots}/${opts.manifest.totalRequiredSlots} cubiertos · faltan ${lastMissing}${lastExcess > 0 ? ` · sobran ${lastExcess}` : ''}`,
  };
}
