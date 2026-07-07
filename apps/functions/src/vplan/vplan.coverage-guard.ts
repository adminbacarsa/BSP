/**
 * VPLAN — guardia de cobertura SLA al aplicar fixes CCT/bandas.
 * Evita convertir turno→F si eso incrementa slots descubiertos.
 */

import { buildDetailedCoverageAudit } from './vplan.coverage-audit';
import type { VplanExistingAssignment } from './vplan.firestore';
import type { VplanPositionDef } from './vplan.positions';
import type {
  VplanAssignment,
  VplanDemandModel,
  VplanScheduleDraft,
} from './vplan.types';

export interface CoverageGuardContext {
  demand: VplanDemandModel;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  dateStrList: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
}

export function countMissingCoverageSlots(
  assignments: VplanAssignment[],
  draftMeta: Pick<VplanScheduleDraft, 'sourceEngine'>,
  guard: CoverageGuardContext,
): number {
  const audit = buildDetailedCoverageAudit({
    draft: { ...draftMeta, assignments },
    demand: guard.demand,
    positions: guard.positions,
    defaultPositionByEmp: guard.defaultPositionByEmp,
    dateStrs: guard.dateStrList,
    cycle: guard.cycle,
    previousMonthAssignments: guard.previousMonthAssignments,
  });
  return audit.totalMissingSlots;
}

export function buildCoverageGuard(opts: {
  protect: boolean;
  demand: VplanDemandModel;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  dateStrList: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
}): CoverageGuardContext & { protect: boolean } {
  return {
    protect: opts.protect,
    demand: opts.demand,
    positions: opts.positions,
    defaultPositionByEmp: opts.defaultPositionByEmp,
    dateStrList: opts.dateStrList,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
  };
}

/** ¿Convertir celda a F incrementaría huecos SLA? */
export function wouldReduceCoverageByForcingFranco(opts: {
  assignments: VplanAssignment[];
  draftMeta: Pick<VplanScheduleDraft, 'sourceEngine'>;
  guard: CoverageGuardContext;
  empId: string;
  dateStr: string;
  proposedCode?: string;
}): boolean {
  const before = countMissingCoverageSlots(
    opts.assignments,
    opts.draftMeta,
    opts.guard,
  );

  const idx = opts.assignments.findIndex(
    (a) => a.employeeId === opts.empId && a.dateStr === opts.dateStr,
  );
  if (idx < 0) return false;

  const next = opts.assignments.map((a) => ({ ...a }));
  const cell = next[idx]!;
  const newCode = (opts.proposedCode ?? 'F').toUpperCase();
  next[idx] = {
    ...cell,
    code: newCode,
    positionName: newCode === 'F' ? '' : cell.positionName,
    hours: newCode === 'F' ? 0 : cell.hours,
  };

  const after = countMissingCoverageSlots(next, opts.draftMeta, opts.guard);
  return after > before;
}
