/**
 * Fase 5 VPLAN — motor embebido + CCT 6+2 estricto + escalera de cobertura.
 * Nunca fuerza 7º día: CCT enforce → escalera → NR si no hay candidato legal.
 */

import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import { resolvePlanningRules } from '../../planning/planning-rules.service';
import { generateSchedule } from '../../scheduling/autoScheduleEngine';
import { enforceCctWorkRestPattern } from '../vplan.cct-enforce';
import { buildCoverageGuard } from '../vplan.coverage-guard';
import { patchMonthOpeningContinuity, computeOpeningProtectedCells, computeOpeningRestProtectedCells, enforceIllegalBandRest } from '../vplan.cycle-continuity';
import { resolveOpeningSlotsForVplan } from '../vplan.cycle-generate';
import { previousMonth, buildMonthDays } from '../vplan.calendar';
import { fillAssignableGapsFromAudit, fillCoverageGapsWithLadder } from '../vplan.coverage-ladder';
import { rebalanceHoursTowardSla } from '../vplan.hour-rebalance';
import { enforceCustomPositionSchedules, computeCustomScheduleProtectedCells, enforceMaxRestStreak } from '../vplan.custom-schedule';
import { capDefaultPositionByEmp, stripExcessSlaAssignments } from '../vplan.sla-enforce';
import { positionsForCycle } from '../vplan.positions';
import { enforceAssigned24hsPositions } from '../vplan.assigned-positions';
import { buildEngineContext, engineToVplanAssignments } from '../vplan.engine-bridge';
import { countDraftBillableHours, normalizeAssignmentBillableHours } from '../vplan.assignment-hours';
import type { VplanPlanningSnapshot, VplanPlanningState } from '../vplan.firestore';
import { is4x2Cycle } from '../vplan.cycle-templates';
import type { VplanFixerLogEntry, VplanScheduleDraft, VplanStrategy, VplanDemandModel, VplanAssignment } from '../vplan.types';

export function runVplanGeneration(opts: {
  snapshot: VplanPlanningSnapshot;
  planningState: VplanPlanningState;
  prevPlanningState: VplanPlanningState;
  strategy: VplanStrategy;
  planningRules?: PlanningRulesConfig;
  demand?: VplanDemandModel;
}): VplanScheduleDraft {
  const cycle = opts.strategy.cycle;
  const is4x2 = is4x2Cycle(cycle);
  const fixLog: VplanFixerLogEntry[] = [];
  const rules = resolvePlanningRules(opts.planningRules ?? null);

  const cyclePositions = positionsForCycle(opts.snapshot.positions, cycle);

  const mergedDefaultPositionByEmp = capDefaultPositionByEmp(
    cyclePositions,
    {
      ...opts.prevPlanningState.defaultPositionByEmp,
      ...opts.planningState.defaultPositionByEmp,
    },
    cycle,
  );
  const mergedDefaultShiftByEmp = {
    ...opts.prevPlanningState.defaultShiftByEmp,
    ...opts.planningState.defaultShiftByEmp,
  };

  const ctx = buildEngineContext({
    snapshot: opts.snapshot,
    planningState: opts.planningState,
    prevPlanningState: opts.prevPlanningState,
    strategy: opts.strategy,
  });

  const result = generateSchedule(ctx);
  const dateStrs = opts.snapshot.days.map((d) => d.dateStr);
  const monthFirstDate = dateStrs[0] ?? '';
  const positionGroups = result.stats.positionGroups ?? {};

  const prevMonthDateStrs = opts.snapshot.previousMonthAssignments.length > 0
    ? [...new Set(opts.snapshot.previousMonthAssignments.map((a) => a.dateStr))].sort()
    : [];

  let assignments = engineToVplanAssignments(result.assignments);

  const resolved = resolveOpeningSlotsForVplan({
    cycle,
    prevPlanningState: opts.prevPlanningState,
    prevAssignments: opts.snapshot.previousMonthAssignments,
    prevMonthDateStrs,
    monthFirstDate,
    engineSlots: result.stats.openingSlotByEmp ?? {},
    useTrailing: opts.strategy.modes.useTrailing,
    positionGroups,
    positions: opts.snapshot.positions,
  });

  const openingSlotByEmp = resolved.slots;
  const trailingEmployeeIds = Object.keys(opts.prevPlanningState.lastShiftByEmp || {});
  const ladderCycleOpts = {
    openingSlotByEmp,
    defaultShiftByEmp: mergedDefaultShiftByEmp,
    useTrailing: opts.strategy.modes.useTrailing,
    trailingEmployeeIds,
  };

  const sourceEngineBase = `vplan:${opts.strategy.engine}:${cycle}`;
  const coverageGuard = opts.demand && rules.protectCoverageOnEnforce
    ? buildCoverageGuard({
      protect: true,
      demand: opts.demand,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      dateStrList: dateStrs,
      cycle,
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
    })
    : undefined;

  const runCctEnforce = (assignmentsIn: VplanAssignment[], useCoverageGuard = false) => enforceCctWorkRestPattern({
    draft: { assignments: assignmentsIn, sourceEngine: `${sourceEngineBase}:motor+ladder` },
    dateStrs,
    cycle,
    previousMonthAssignments: opts.snapshot.previousMonthAssignments,
    protectedCells,
    rules,
    coverageGuard: useCoverageGuard ? coverageGuard : undefined,
  });

  if (opts.strategy.modes.preserveExisting && opts.snapshot.existingAssignments.length > 0) {
    const existingMap = new Map<string, typeof assignments[0]>();
    for (const a of opts.snapshot.existingAssignments) {
      existingMap.set(`${a.employeeId}_${a.dateStr}`, a);
    }
    const generatedMap = new Map<string, typeof assignments[0]>();
    for (const a of assignments) {
      generatedMap.set(`${a.employeeId}_${a.dateStr}`, a);
    }
    const mergedKeys = new Set([...existingMap.keys(), ...generatedMap.keys()]);
    assignments = [];
    for (const key of mergedKeys) {
      assignments.push(existingMap.get(key) ?? generatedMap.get(key)!);
    }
  }

  const runYear = opts.snapshot.days[0]?.dateStr
    ? Number(opts.snapshot.days[0].dateStr.slice(0, 4))
    : 0;
  const runMonth = opts.snapshot.days[0]?.dateStr
    ? Number(opts.snapshot.days[0].dateStr.slice(5, 7))
    : 0;
  const prevCal = runYear && runMonth ? previousMonth(runYear, runMonth) : null;
  const prevCalLast = prevCal
    ? buildMonthDays(prevCal.year, prevCal.month).at(-1)?.dateStr
    : undefined;
  const prevMonthLastDate = prevCalLast
    ?? (prevMonthDateStrs.length > 0 ? prevMonthDateStrs[prevMonthDateStrs.length - 1]! : '');

  let protectedCells: Set<string> | undefined;

  if (opts.strategy.modes.useTrailing && prevMonthLastDate && monthFirstDate) {
    const patched = patchMonthOpeningContinuity({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      prevMonthLastDate,
      monthFirstDate,
      prevPlanningState: opts.prevPlanningState,
      positions: opts.snapshot.positions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      defaultShiftByEmp: mergedDefaultShiftByEmp,
      cycle,
      useTrailing: true,
    });
    assignments = patched.draft.assignments;
    fixLog.push(...patched.log);

    protectedCells = new Set([
      ...computeOpeningProtectedCells({
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        prevMonthLastDate,
        monthFirstDate,
        prevPlanningState: opts.prevPlanningState,
        positions: opts.snapshot.positions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        defaultShiftByEmp: mergedDefaultShiftByEmp,
        cycle,
        useTrailing: true,
        draftAssignments: assignments,
      }),
      ...computeOpeningRestProtectedCells({
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        prevMonthLastDate,
        monthFirstDate,
        prevPlanningState: opts.prevPlanningState,
        positions: opts.snapshot.positions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        defaultShiftByEmp: mergedDefaultShiftByEmp,
        cycle,
        useTrailing: true,
        draftAssignments: assignments,
      }),
    ]);

    const strippedSla = stripExcessSlaAssignments({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs: opts.snapshot.days,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      protectedCells,
    });
    assignments = strippedSla.draft.assignments;
    fixLog.push(...strippedSla.log);
  } else {
    const strippedSla = stripExcessSlaAssignments({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs: opts.snapshot.days,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
    });
    assignments = strippedSla.draft.assignments;
    fixLog.push(...strippedSla.log);
  }

  const customFixed = enforceCustomPositionSchedules({
    draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
    dateStrs: opts.snapshot.days,
    positions: opts.snapshot.positions,
    defaultPositionByEmp: mergedDefaultPositionByEmp,
    absences: opts.snapshot.absences,
    openingSlotByEmp,
  });
  assignments = customFixed.draft.assignments;
  fixLog.push(...customFixed.log);

  const positionFixed = enforceAssigned24hsPositions({
    draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
    positions: opts.snapshot.positions,
    defaultPositionByEmp: mergedDefaultPositionByEmp,
  });
  assignments = positionFixed.draft.assignments;
  fixLog.push(...positionFixed.log);

  const cctEnforced = runCctEnforce(assignments);
  assignments = cctEnforced.draft.assignments;
  fixLog.push(...cctEnforced.log);

  const offerHours = opts.snapshot.employees.length * (rules.targetAvgHoursPerEmployee ?? 192);
  const gapFilled = fillCoverageGapsWithLadder({
    draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
    dateStrs: opts.snapshot.days,
    positions: cyclePositions,
    defaultPositionByEmp: mergedDefaultPositionByEmp,
    cycle,
    dateStrList: dateStrs,
    previousMonthAssignments: opts.snapshot.previousMonthAssignments,
    slaVendidas: opts.snapshot.slaVendidas,
    offerHours,
    employeeIds: opts.snapshot.employees.map((e) => e.id),
    rules,
    protectedCells,
  });
  assignments = gapFilled.draft.assignments;
  fixLog.push(...gapFilled.log);

  const rebalanced = rebalanceHoursTowardSla({
    draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
    dateStrs: opts.snapshot.days,
    positions: cyclePositions,
    defaultPositionByEmp: mergedDefaultPositionByEmp,
    cycle,
    dateStrList: dateStrs,
    slaVendidas: opts.snapshot.slaVendidas,
    employeeIds: opts.snapshot.employees.map((e) => e.id),
    previousMonthAssignments: opts.snapshot.previousMonthAssignments,
    rules,
    protectedCells,
  });
  assignments = rebalanced.draft.assignments;
  fixLog.push(...rebalanced.log);

  const cctFinal = runCctEnforce(assignments);
  assignments = cctFinal.draft.assignments;
  fixLog.push(...cctFinal.log);

  if (cctFinal.log.length > 0) {
    const gapRefill = fillCoverageGapsWithLadder({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs: opts.snapshot.days,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      cycle,
      dateStrList: dateStrs,
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      slaVendidas: opts.snapshot.slaVendidas,
      offerHours,
      employeeIds: opts.snapshot.employees.map((e) => e.id),
      rules,
      protectedCells,
    });
    assignments = gapRefill.draft.assignments;
    fixLog.push(...gapRefill.log);
    gapFilled.ladderStats.subgrupo6x2 += gapRefill.ladderStats.subgrupo6x2;
    gapFilled.ladderStats.refuerzo4x2 += gapRefill.ladderStats.refuerzo4x2;
    gapFilled.ladderStats.sinTurno += gapRefill.ladderStats.sinTurno;
    gapFilled.ladderStats.ret += gapRefill.ladderStats.ret;
    gapFilled.ladderStats.ft += gapRefill.ladderStats.ft;
    gapFilled.ladderStats.needsReinforcement += gapRefill.ladderStats.needsReinforcement;
    gapFilled.ladderStats.bandSwap += gapRefill.ladderStats.bandSwap;

    const rebalance2 = rebalanceHoursTowardSla({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs: opts.snapshot.days,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      cycle,
      dateStrList: dateStrs,
      slaVendidas: opts.snapshot.slaVendidas,
      employeeIds: opts.snapshot.employees.map((e) => e.id),
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      rules,
      protectedCells,
    });
    assignments = rebalance2.draft.assignments;
    fixLog.push(...rebalance2.log);
    rebalanced.hoursAdded += rebalance2.hoursAdded;

    const cctAfterRebalance = runCctEnforce(assignments);
    assignments = cctAfterRebalance.draft.assignments;
    fixLog.push(...cctAfterRebalance.log);

    const gapRefill2 = fillCoverageGapsWithLadder({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs: opts.snapshot.days,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      cycle,
      dateStrList: dateStrs,
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      slaVendidas: opts.snapshot.slaVendidas,
      offerHours,
      employeeIds: opts.snapshot.employees.map((e) => e.id),
      rules,
      protectedCells,
    });
    assignments = gapRefill2.draft.assignments;
    fixLog.push(...gapRefill2.log);
    gapFilled.ladderStats.subgrupo6x2 += gapRefill2.ladderStats.subgrupo6x2;
    gapFilled.ladderStats.refuerzo4x2 += gapRefill2.ladderStats.refuerzo4x2;
    gapFilled.ladderStats.sinTurno += gapRefill2.ladderStats.sinTurno;
    gapFilled.ladderStats.ret += gapRefill2.ladderStats.ret;
    gapFilled.ladderStats.ft += gapRefill2.ladderStats.ft;
    gapFilled.ladderStats.needsReinforcement += gapRefill2.ladderStats.needsReinforcement;
    gapFilled.ladderStats.bandSwap += gapRefill2.ladderStats.bandSwap;

    const rebalance3 = rebalanceHoursTowardSla({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs: opts.snapshot.days,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      cycle,
      dateStrList: dateStrs,
      slaVendidas: opts.snapshot.slaVendidas,
      employeeIds: opts.snapshot.employees.map((e) => e.id),
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      rules,
      protectedCells,
    });
    assignments = rebalance3.draft.assignments;
    fixLog.push(...rebalance3.log);
    rebalanced.hoursAdded += rebalance3.hoursAdded;

    const cctFinal2 = runCctEnforce(assignments);
    assignments = cctFinal2.draft.assignments;
    fixLog.push(...cctFinal2.log);
  }

  for (let closePass = 0; closePass < 2; closePass += 1) {
    const closeLadder = fillCoverageGapsWithLadder({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs: opts.snapshot.days,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      cycle,
      dateStrList: dateStrs,
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      slaVendidas: opts.snapshot.slaVendidas,
      offerHours,
      employeeIds: opts.snapshot.employees.map((e) => e.id),
      rules,
      protectedCells,
    });
    assignments = closeLadder.draft.assignments;
    fixLog.push(...closeLadder.log);
    gapFilled.ladderStats.subgrupo6x2 += closeLadder.ladderStats.subgrupo6x2;
    gapFilled.ladderStats.refuerzo4x2 += closeLadder.ladderStats.refuerzo4x2;
    gapFilled.ladderStats.sinTurno += closeLadder.ladderStats.sinTurno;
    gapFilled.ladderStats.ret += closeLadder.ladderStats.ret;
    gapFilled.ladderStats.ft += closeLadder.ladderStats.ft;
    gapFilled.ladderStats.needsReinforcement += closeLadder.ladderStats.needsReinforcement;
    gapFilled.ladderStats.bandSwap += closeLadder.ladderStats.bandSwap;
    gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + (closeLadder.ladderStats.auditGap ?? 0);

    const closeCct = runCctEnforce(assignments, true);
    assignments = closeCct.draft.assignments;
    fixLog.push(...closeCct.log);

    let auditFilledThisPass = 0;
    if (opts.demand) {
      const auditFill = fillAssignableGapsFromAudit({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        demand: opts.demand,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        dateStrList: dateStrs,
        cycle,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        rules,
        protectedCells,
      });
      assignments = auditFill.draft.assignments;
      fixLog.push(...auditFill.log);
      gapFilled.ladderStats.subgrupo6x2 += auditFill.ladderStats.subgrupo6x2;
      auditFilledThisPass = auditFill.ladderStats.auditGap;
      gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + auditFilledThisPass;
    }

    if (closeCct.log.length === 0 && auditFilledThisPass === 0) break;
  }

  if (opts.demand) {
    for (let finalPass = 0; finalPass < 6; finalPass += 1) {
      const finalCct = runCctEnforce(assignments);
      assignments = finalCct.draft.assignments;
      fixLog.push(...finalCct.log);

      const finalAuditFill = fillAssignableGapsFromAudit({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        demand: opts.demand,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        dateStrList: dateStrs,
        cycle,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        rules,
        protectedCells,
      });
      assignments = finalAuditFill.draft.assignments;
      fixLog.push(...finalAuditFill.log);
      gapFilled.ladderStats.subgrupo6x2 += finalAuditFill.ladderStats.subgrupo6x2;
      gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + finalAuditFill.ladderStats.auditGap;

      const ladderClose = fillCoverageGapsWithLadder({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs: opts.snapshot.days,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        cycle,
        dateStrList: dateStrs,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        slaVendidas: opts.snapshot.slaVendidas,
        offerHours,
        employeeIds: opts.snapshot.employees.map((e) => e.id),
        rules,
        protectedCells,
      });
      assignments = ladderClose.draft.assignments;
      fixLog.push(...ladderClose.log);
      gapFilled.ladderStats.subgrupo6x2 += ladderClose.ladderStats.subgrupo6x2;
      gapFilled.ladderStats.refuerzo4x2 += ladderClose.ladderStats.refuerzo4x2;
      gapFilled.ladderStats.sinTurno += ladderClose.ladderStats.sinTurno;
      gapFilled.ladderStats.ret += ladderClose.ladderStats.ret;
      gapFilled.ladderStats.ft += ladderClose.ladderStats.ft;
      gapFilled.ladderStats.needsReinforcement += ladderClose.ladderStats.needsReinforcement;
      gapFilled.ladderStats.bandSwap += ladderClose.ladderStats.bandSwap;

      const ladderMoved = ladderClose.ladderStats.subgrupo6x2
        + ladderClose.ladderStats.refuerzo4x2
        + ladderClose.ladderStats.sinTurno
        + ladderClose.ladderStats.ret
        + ladderClose.ladderStats.ft
        + ladderClose.ladderStats.bandSwap;

      if (finalCct.log.length === 0
        && finalAuditFill.ladderStats.auditGap === 0
        && ladderMoved === 0) {
        break;
      }
    }

    for (let bandPass = 0; bandPass < 3; bandPass += 1) {
      const bandFix = enforceIllegalBandRest({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs,
        minRestHours: rules.minRestHoursBetweenBands ?? 12,
        protectedCells,
      });
      if (bandFix.log.length === 0) break;

      assignments = bandFix.draft.assignments;
      fixLog.push(...bandFix.log);

      const postBandCct = runCctEnforce(assignments);
      assignments = postBandCct.draft.assignments;
      fixLog.push(...postBandCct.log);

      const postBandAudit = fillAssignableGapsFromAudit({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        demand: opts.demand,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        dateStrList: dateStrs,
        cycle,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        rules,
        protectedCells,
      });
      assignments = postBandAudit.draft.assignments;
      fixLog.push(...postBandAudit.log);
      gapFilled.ladderStats.subgrupo6x2 += postBandAudit.ladderStats.subgrupo6x2;
      gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + postBandAudit.ladderStats.auditGap;

      const postBandLadder = fillCoverageGapsWithLadder({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs: opts.snapshot.days,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        cycle,
        dateStrList: dateStrs,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        slaVendidas: opts.snapshot.slaVendidas,
        offerHours,
        employeeIds: opts.snapshot.employees.map((e) => e.id),
        rules,
        protectedCells,
      });
      assignments = postBandLadder.draft.assignments;
      fixLog.push(...postBandLadder.log);
      gapFilled.ladderStats.subgrupo6x2 += postBandLadder.ladderStats.subgrupo6x2;
      gapFilled.ladderStats.sinTurno += postBandLadder.ladderStats.sinTurno;
      gapFilled.ladderStats.bandSwap += postBandLadder.ladderStats.bandSwap;
    }
  }

  const customFinal = enforceCustomPositionSchedules({
    draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
    dateStrs: opts.snapshot.days,
    positions: opts.snapshot.positions,
    defaultPositionByEmp: mergedDefaultPositionByEmp,
    absences: opts.snapshot.absences,
    openingSlotByEmp,
  });
  assignments = customFinal.draft.assignments;
  fixLog.push(...customFinal.log);

  if (opts.demand) {
    const customWeekendProtected = computeCustomScheduleProtectedCells({
      dateStrs: opts.snapshot.days,
      positions: opts.snapshot.positions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      draftAssignments: assignments,
    });
    const weekendProtected = customWeekendProtected.size > 0
      ? new Set([...(protectedCells ?? []), ...customWeekendProtected])
      : protectedCells;

    const postCustomRest = enforceMaxRestStreak({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs,
      cycle,
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      rules,
      protectedCells: weekendProtected,
      positions: opts.snapshot.positions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      defaultShiftByEmp: mergedDefaultShiftByEmp,
    });
    assignments = postCustomRest.draft.assignments;
    fixLog.push(...postCustomRest.log);

    const postCustomLadder = fillCoverageGapsWithLadder({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs: opts.snapshot.days,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      cycle,
      dateStrList: dateStrs,
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      slaVendidas: opts.snapshot.slaVendidas,
      offerHours,
      employeeIds: opts.snapshot.employees.map((e) => e.id),
      rules,
      protectedCells: weekendProtected,
      excludeCustomCrossPool: true,
      allowFrancoTrabajado: true,
      ...ladderCycleOpts,
    });
    assignments = postCustomLadder.draft.assignments;
    fixLog.push(...postCustomLadder.log);
    gapFilled.ladderStats.subgrupo6x2 += postCustomLadder.ladderStats.subgrupo6x2;
    gapFilled.ladderStats.sinTurno += postCustomLadder.ladderStats.sinTurno;
    gapFilled.ladderStats.ft += postCustomLadder.ladderStats.ft;
    gapFilled.ladderStats.needsReinforcement += postCustomLadder.ladderStats.needsReinforcement;

    const postCustomAudit = fillAssignableGapsFromAudit({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      demand: opts.demand,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      dateStrList: dateStrs,
      cycle,
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      rules,
      protectedCells: weekendProtected,
      allowFrancoTrabajado: true,
    });
    assignments = postCustomAudit.draft.assignments;
    fixLog.push(...postCustomAudit.log);
    gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + postCustomAudit.ladderStats.auditGap;
    gapFilled.ladderStats.bandSwap = (gapFilled.ladderStats.bandSwap ?? 0)
      + (postCustomLadder.ladderStats.bandSwap ?? 0);

    // Preservar FT/cobertura recién cerrada (no tumbar a F el CCT estricto)
    const postCustomCct = runCctEnforce(assignments, true);
    assignments = postCustomCct.draft.assignments;
    fixLog.push(...postCustomCct.log);

    if (postCustomCct.log.some((e) => e.code === 'CCT_REST_BLOCK' || e.code === 'CCT_MAX_WORK')) {
      const refill = fillCoverageGapsWithLadder({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs: opts.snapshot.days,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        cycle,
        dateStrList: dateStrs,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        slaVendidas: opts.snapshot.slaVendidas,
        offerHours,
        employeeIds: opts.snapshot.employees.map((e) => e.id),
        rules,
        protectedCells: weekendProtected,
        excludeCustomCrossPool: true,
        allowFrancoTrabajado: true,
        ...ladderCycleOpts,
      });
      assignments = refill.draft.assignments;
      fixLog.push(...refill.log);
      gapFilled.ladderStats.ft += refill.ladderStats.ft;
      gapFilled.ladderStats.bandSwap += refill.ladderStats.bandSwap;
      gapFilled.ladderStats.subgrupo6x2 += refill.ladderStats.subgrupo6x2;
    }

    const postCustomRest2 = enforceMaxRestStreak({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs,
      cycle,
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      rules,
      protectedCells: weekendProtected,
      positions: opts.snapshot.positions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      defaultShiftByEmp: mergedDefaultShiftByEmp,
    });
    assignments = postCustomRest2.draft.assignments;
    fixLog.push(...postCustomRest2.log);

    const customFinal2 = enforceCustomPositionSchedules({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs: opts.snapshot.days,
      positions: opts.snapshot.positions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      absences: opts.snapshot.absences,
      openingSlotByEmp,
    });
    assignments = customFinal2.draft.assignments;
    fixLog.push(...customFinal2.log);

    const cycleProtectedCells = new Set<string>([
      ...(weekendProtected ?? []),
      ...(protectedCells ?? []),
      ...(opts.strategy.modes.useTrailing && prevMonthLastDate && monthFirstDate
        ? [
          ...computeOpeningProtectedCells({
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            prevMonthLastDate,
            monthFirstDate,
            prevPlanningState: opts.prevPlanningState,
            positions: opts.snapshot.positions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            defaultShiftByEmp: mergedDefaultShiftByEmp,
            cycle,
            useTrailing: true,
            draftAssignments: assignments,
          }),
          ...computeOpeningRestProtectedCells({
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            prevMonthLastDate,
            monthFirstDate,
            prevPlanningState: opts.prevPlanningState,
            positions: opts.snapshot.positions,
            defaultPositionByEmp: mergedDefaultPositionByEmp,
            defaultShiftByEmp: mergedDefaultShiftByEmp,
            cycle,
            useTrailing: true,
            draftAssignments: assignments,
          }),
        ]
        : []),
    ]);

    const postCustomBandRest = enforceIllegalBandRest({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs,
      minRestHours: rules.minRestHoursBetweenBands ?? 12,
      protectedCells: cycleProtectedCells,
    });
    assignments = postCustomBandRest.draft.assignments;
    fixLog.push(...postCustomBandRest.log);

    if (postCustomBandRest.log.length > 0) {
      const bandRestRefill = fillCoverageGapsWithLadder({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs: opts.snapshot.days,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        cycle,
        dateStrList: dateStrs,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        slaVendidas: opts.snapshot.slaVendidas,
        offerHours,
        employeeIds: opts.snapshot.employees.map((e) => e.id),
        rules,
        protectedCells: cycleProtectedCells,
        excludeCustomCrossPool: true,
        allowFrancoTrabajado: false,
        ...ladderCycleOpts,
      });
      assignments = bandRestRefill.draft.assignments;
      fixLog.push(...bandRestRefill.log);
      gapFilled.ladderStats.subgrupo6x2 += bandRestRefill.ladderStats.subgrupo6x2;
      gapFilled.ladderStats.bandSwap += bandRestRefill.ladderStats.bandSwap;
      gapFilled.ladderStats.sinTurno += bandRestRefill.ladderStats.sinTurno;

      const bandRestAudit = fillAssignableGapsFromAudit({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        demand: opts.demand,
        positions: cyclePositions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        dateStrList: dateStrs,
        cycle,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        rules,
        protectedCells: cycleProtectedCells,
        allowFrancoTrabajado: false,
      });
      assignments = bandRestAudit.draft.assignments;
      fixLog.push(...bandRestAudit.log);
      gapFilled.ladderStats.auditGap = (gapFilled.ladderStats.auditGap ?? 0) + bandRestAudit.ladderStats.auditGap;

      const customFinal3 = enforceCustomPositionSchedules({
        draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
        dateStrs: opts.snapshot.days,
        positions: opts.snapshot.positions,
        defaultPositionByEmp: mergedDefaultPositionByEmp,
        absences: opts.snapshot.absences,
        openingSlotByEmp,
      });
      assignments = customFinal3.draft.assignments;
      fixLog.push(...customFinal3.log);
    }

    const hourNormalizePre = normalizeAssignmentBillableHours(assignments, {
      cycle,
      positions: opts.snapshot.positions,
    });
    assignments = hourNormalizePre.assignments;
    fixLog.push(...hourNormalizePre.log);

    const postHourClose = rebalanceHoursTowardSla({
      draft: { assignments, sourceEngine: `vplan:${opts.strategy.engine}:${cycle}` },
      dateStrs: opts.snapshot.days,
      positions: cyclePositions,
      defaultPositionByEmp: mergedDefaultPositionByEmp,
      cycle,
      dateStrList: dateStrs,
      slaVendidas: opts.snapshot.slaVendidas,
      employeeIds: opts.snapshot.employees.map((e) => e.id),
      previousMonthAssignments: opts.snapshot.previousMonthAssignments,
      rules,
      protectedCells: weekendProtected,
      tolerance: 0,
    });
    assignments = postHourClose.draft.assignments;
    fixLog.push(...postHourClose.log);
    rebalanced.hoursAdded += postHourClose.hoursAdded;
  }

  const hourNormalizeFinal = normalizeAssignmentBillableHours(assignments, {
    cycle,
    positions: opts.snapshot.positions,
  });
  assignments = hourNormalizeFinal.assignments;
  fixLog.push(...hourNormalizeFinal.log);

  const openingProtectedCells = protectedCells
    ? [...protectedCells]
    : (opts.strategy.modes.useTrailing && prevMonthLastDate && monthFirstDate
      ? [...new Set([
        ...computeOpeningProtectedCells({
          previousMonthAssignments: opts.snapshot.previousMonthAssignments,
          prevMonthLastDate,
          monthFirstDate,
          prevPlanningState: opts.prevPlanningState,
          positions: opts.snapshot.positions,
          defaultPositionByEmp: mergedDefaultPositionByEmp,
          defaultShiftByEmp: mergedDefaultShiftByEmp,
          cycle,
          useTrailing: true,
          draftAssignments: assignments,
        }),
        ...computeOpeningRestProtectedCells({
          previousMonthAssignments: opts.snapshot.previousMonthAssignments,
          prevMonthLastDate,
          monthFirstDate,
          prevPlanningState: opts.prevPlanningState,
          positions: opts.snapshot.positions,
          defaultPositionByEmp: mergedDefaultPositionByEmp,
          defaultShiftByEmp: mergedDefaultShiftByEmp,
          cycle,
          useTrailing: true,
          draftAssignments: assignments,
        }),
      ])]
      : undefined);

  const billableAfterPipeline = countDraftBillableHours(assignments, {
    cycle,
    positions: opts.snapshot.positions,
  });

  return {
    assignments,
    sourceEngine: `vplan:${opts.strategy.engine}:${cycle}${is4x2 ? ':D12N12' : ''}:motor+ladder`,
    stats: {
      totalBillableHours: billableAfterPipeline,
      motorBillableHours: Math.round(result.stats.totalBillableHours),
      targetHours: result.stats.targetHours,
      slaHoursClosed: result.stats.slaHoursClosed,
      employeeCount: opts.snapshot.employees.length,
      continuityFixes: fixLog.length,
      openingSlotCount: Object.keys(openingSlotByEmp).length,
      openingSlotByEmp,
      openingProtectedCells,
      historySlotCount: resolved.historyCount,
      trailingSlotCount: resolved.trailingCount,
      needsReinforcementCount: gapFilled.ladderStats.needsReinforcement,
      coverageLadder: gapFilled.ladderStats,
      hourRebalanceAdded: rebalanced.hoursAdded,
    },
  };
}
