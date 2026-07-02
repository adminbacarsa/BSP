/**
 * Fase 5 VPLAN — generación determinística (motor 6+2 / custom).
 */

import { generateSchedule } from '../../scheduling/autoScheduleEngine';
import { buildEngineContext, engineToVplanAssignments } from '../vplan.engine-bridge';
import type { VplanPlanningSnapshot, VplanPlanningState } from '../vplan.firestore';
import type { VplanScheduleDraft, VplanStrategy } from '../vplan.types';

export function runVplanGeneration(opts: {
  snapshot: VplanPlanningSnapshot;
  planningState: VplanPlanningState;
  prevPlanningState: VplanPlanningState;
  strategy: VplanStrategy;
}): VplanScheduleDraft {
  const ctx = buildEngineContext({
    snapshot: opts.snapshot,
    planningState: opts.planningState,
    prevPlanningState: opts.prevPlanningState,
    strategy: opts.strategy,
  });

  const result = generateSchedule(ctx);
  let assignments = engineToVplanAssignments(result.assignments);

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

  return {
    assignments,
    sourceEngine: `vplan:${opts.strategy.engine}:${opts.strategy.cycle}`,
    stats: {
      totalBillableHours: result.stats.totalBillableHours,
      targetHours: result.stats.targetHours,
      slaHoursClosed: result.stats.slaHoursClosed,
      employeeCount: opts.snapshot.employees.length,
    },
  };
}
