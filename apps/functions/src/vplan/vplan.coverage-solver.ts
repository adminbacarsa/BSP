/**
 * VPLAN — solver combinatorio de cobertura SLA.
 * 1) Cerrar slots (F libres, tags de puesto)
 * 2) Band guard + CCT al final, con protección de cobertura si está activa
 */

import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import { resolvePlanningRules } from '../planning/planning-rules.service';
import { enforceCctWorkRestPattern, wouldExceedCctWorkStreak } from './vplan.cct-enforce';
import { buildDetailedCoverageAudit } from './vplan.coverage-audit';
import type { CoverageGuardContext } from './vplan.coverage-guard';
import { guardIllegalBandTransitions, protectedCellKey } from './vplan.cycle-continuity';
import type { VplanExistingAssignment } from './vplan.firestore';
import { isVirtualEmployeeId, shiftBandHours, type VplanPositionDef } from './vplan.positions';
import { fillCoverageGaps, normBandCode, stripExcessSlaAssignments } from './vplan.sla-enforce';
import type {
  VplanAssignment,
  VplanCoverageAuditReport,
  VplanDemandModel,
  VplanFixerLogEntry,
  VplanScheduleDraft,
} from './vplan.types';

const FRANCO = new Set(['F', 'FF', 'FP']);
const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);

function assignmentIndex(
  assignments: Array<{ employeeId: string; dateStr: string }>,
  empId: string,
  dateStr: string,
): number {
  return assignments.findIndex((a) => a.employeeId === empId && a.dateStr === dateStr);
}

function isWorkCode(code: string): boolean {
  const c = String(code || '').toUpperCase();
  return !!c && !FRANCO.has(c) && c !== 'RET' && c !== 'R';
}

function sumBillableHours(assignments: VplanAssignment[]): number {
  let total = 0;
  for (const a of assignments) {
    const code = String(a.code || '').toUpperCase();
    if (!BILLABLE.has(code)) continue;
    total += a.hours ?? 8;
  }
  return total;
}

function isProtectedCell(
  empId: string,
  dateStr: string,
  protectedCells?: Set<string>,
): boolean {
  return protectedCells?.has(protectedCellKey(empId, dateStr)) === true;
}

function candidatePassesCct(opts: {
  assignments: VplanAssignment[];
  empId: string;
  dateStr: string;
  shiftCode: string;
  dateStrList: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  rules?: PlanningRulesConfig;
}): boolean {
  const cct = wouldExceedCctWorkStreak({
    assignments: opts.assignments,
    dateStrs: opts.dateStrList,
    empId: opts.empId,
    dateStr: opts.dateStr,
    shiftCode: opts.shiftCode,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
    rules: opts.rules,
  });
  return cct.ok;
}

function buildCoverageGuard(opts: {
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

function fillGapOpts(
  opts: {
    draft: VplanScheduleDraft;
    assignments: VplanAssignment[];
    dateStrs: Array<{ dateStr: string; dayLetter: string }>;
    dateStrList: string[];
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    rules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
  },
): Parameters<typeof fillCoverageGaps>[0] {
  return {
    draft: { ...opts.draft, assignments: opts.assignments },
    dateStrs: opts.dateStrs,
    positions: opts.positions,
    defaultPositionByEmp: opts.defaultPositionByEmp,
    cycle: opts.cycle,
    dateStrList: opts.dateStrList,
    previousMonthAssignments: opts.previousMonthAssignments,
    rules: opts.rules,
    protectedCells: opts.protectedCells,
  };
}

function runCoverageClosurePass(opts: {
  draft: VplanScheduleDraft;
  assignments: VplanAssignment[];
  demand: VplanDemandModel;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  dateStrs: Array<{ dateStr: string; dayLetter: string }>;
  dateStrList: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  employeeNames?: Record<string, string>;
  maxIterations: number;
  rules?: PlanningRulesConfig;
  protectedCells?: Set<string>;
}): {
  assignments: typeof opts.assignments;
  log: VplanFixerLogEntry[];
  audit: VplanCoverageAuditReport;
  iterations: number;
} {
  const log: VplanFixerLogEntry[] = [];
  let assignments = [...opts.assignments];
  let audit: VplanCoverageAuditReport = {
    ok: false,
    totalGaps: 0,
    totalMissingSlots: 0,
    totalExcessSlots: 0,
    gaps: [],
  };
  let iter = 0;
  const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));

  for (; iter < opts.maxIterations; iter++) {
    audit = buildDetailedCoverageAudit({
      draft: { ...opts.draft, assignments },
      demand: opts.demand,
      positions: opts.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      dateStrs: opts.dateStrList,
      cycle: opts.cycle,
      previousMonthAssignments: opts.previousMonthAssignments,
      employeeNames: opts.employeeNames,
      rules: opts.rules,
    });

    if (audit.ok) break;

    let applied = false;

    for (const gap of audit.gaps) {
      if (gap.missing <= 0) continue;

      const pos = posByName.get(gap.positionName);
      const shift = pos?.shifts?.find((s) => String(s.code || '').toUpperCase() === gap.shiftCode);
      const hours = shift ? shiftBandHours(shift) : 8;

      const sortedCandidates = [...gap.candidates].sort((a, b) => {
        const aProt = isProtectedCell(a.employeeId, gap.dateStr, opts.protectedCells) ? 1 : 0;
        const bProt = isProtectedCell(b.employeeId, gap.dateStr, opts.protectedCells) ? 1 : 0;
        if (aProt !== bProt) return aProt - bProt;
        const aCct = candidatePassesCct({
          assignments,
          empId: a.employeeId,
          dateStr: gap.dateStr,
          shiftCode: gap.shiftCode,
          dateStrList: opts.dateStrList,
          cycle: opts.cycle,
          previousMonthAssignments: opts.previousMonthAssignments,
          rules: opts.rules,
        }) ? 0 : 1;
        const bCct = candidatePassesCct({
          assignments,
          empId: b.employeeId,
          dateStr: gap.dateStr,
          shiftCode: gap.shiftCode,
          dateStrList: opts.dateStrList,
          cycle: opts.cycle,
          previousMonthAssignments: opts.previousMonthAssignments,
          rules: opts.rules,
        }) ? 0 : 1;
        return aCct - bCct;
      });

      for (const cand of sortedCandidates) {
        if (!cand.canAssign) continue;
        if (isVirtualEmployeeId(cand.employeeId)) continue;
        if (isProtectedCell(cand.employeeId, gap.dateStr, opts.protectedCells)) continue;

        if (!candidatePassesCct({
          assignments,
          empId: cand.employeeId,
          dateStr: gap.dateStr,
          shiftCode: gap.shiftCode,
          dateStrList: opts.dateStrList,
          cycle: opts.cycle,
          previousMonthAssignments: opts.previousMonthAssignments,
          rules: opts.rules,
        })) {
          continue;
        }

        const idx = assignmentIndex(assignments, cand.employeeId, gap.dateStr);
        const currentCode = cand.currentCode.toUpperCase();
        const sameBand = isWorkCode(currentCode)
          && normBandCode(currentCode) === normBandCode(gap.shiftCode);

        if (idx >= 0) {
          const existing = assignments[idx]!;
          const existingPos = String(existing.positionName || '').trim();
          const existingCode = String(existing.code || '').toUpperCase();

          if (
            sameBand
            && existingPos === gap.positionName
            && normBandCode(existingCode) === normBandCode(gap.shiftCode)
          ) {
            continue;
          }

          if (sameBand && FRANCO.has(existingCode)) {
            assignments[idx] = {
              ...existing,
              code: gap.shiftCode,
              positionName: gap.positionName,
              hours,
            };
            log.push({
              code: 'COVERAGE_SOLVE',
              message: `${currentCode} → ${gap.shiftCode} en ${gap.positionName} (${gap.dateStr})`,
              employeeId: cand.employeeId,
              dateStr: gap.dateStr,
            });
          } else if (sameBand) {
            assignments[idx] = {
              ...existing,
              positionName: gap.positionName,
              hours: existing.hours ?? hours,
            };
            log.push({
              code: 'POSITION_TAG',
              message: `Tag ${gap.shiftCode} → ${gap.positionName} (${gap.dateStr})`,
              employeeId: cand.employeeId,
              dateStr: gap.dateStr,
            });
          } else {
            assignments[idx] = {
              ...existing,
              code: gap.shiftCode,
              positionName: gap.positionName,
              hours,
            };
            log.push({
              code: 'COVERAGE_SOLVE',
              message: `${currentCode} → ${gap.shiftCode} en ${gap.positionName} (${gap.dateStr})`,
              employeeId: cand.employeeId,
              dateStr: gap.dateStr,
            });
          }
        } else {
          assignments.push({
            employeeId: cand.employeeId,
            dateStr: gap.dateStr,
            code: gap.shiftCode,
            positionName: gap.positionName,
            hours,
          });
          log.push({
            code: 'COVERAGE_SOLVE',
            message: `${currentCode} → ${gap.shiftCode} en ${gap.positionName} (${gap.dateStr})`,
            employeeId: cand.employeeId,
            dateStr: gap.dateStr,
          });
        }

        applied = true;
        break;
      }
    }

    if (!applied) {
      const filled = fillCoverageGaps(fillGapOpts({
        draft: opts.draft,
        assignments,
        dateStrs: opts.dateStrs,
        dateStrList: opts.dateStrList,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        rules: opts.rules,
        protectedCells: opts.protectedCells,
      }));
      if (filled.log.length > 0) {
        assignments = filled.draft.assignments;
        log.push(...filled.log);
        continue;
      }

      const stripped = stripExcessSlaAssignments({
        draft: { ...opts.draft, assignments },
        dateStrs: opts.dateStrs,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        protectedCells: opts.protectedCells,
      });
      if (stripped.log.length > 0) {
        assignments = stripped.draft.assignments;
        log.push(...stripped.log);
        continue;
      }

      break;
    }
  }

  audit.iterationsUsed = iter;
  return { assignments, log, audit, iterations: iter };
}

function runSafeCctRebound(opts: {
  draft: VplanScheduleDraft;
  assignments: VplanAssignment[];
  demand: VplanDemandModel;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  dateStrs: Array<{ dateStr: string; dayLetter: string }>;
  dateStrList: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  employeeNames?: Record<string, string>;
  rules: PlanningRulesConfig;
  protectedCells?: Set<string>;
  maxIterations: number;
}): { assignments: VplanAssignment[]; log: VplanFixerLogEntry[]; iterations: number } {
  const rebound = runCoverageClosurePass({
    draft: opts.draft,
    assignments: opts.assignments,
    demand: opts.demand,
    positions: opts.positions,
    defaultPositionByEmp: opts.defaultPositionByEmp,
    dateStrs: opts.dateStrs,
    dateStrList: opts.dateStrList,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
    employeeNames: opts.employeeNames,
    maxIterations: opts.maxIterations,
    rules: opts.rules,
    protectedCells: opts.protectedCells,
  });
  return {
    assignments: rebound.assignments,
    log: rebound.log,
    iterations: rebound.iterations,
  };
}

/**
 * Cierra huecos SLA probando candidatos del subgrupo.
 * Pipeline seguro: respeta fase 5 → bandas → CCT estricto → rebound CCT-safe.
 */
export function runCoverageSolverLoop(opts: {
  draft: VplanScheduleDraft;
  demand: VplanDemandModel;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  dateStrs: Array<{ dateStr: string; dayLetter: string }>;
  dateStrList: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  employeeNames?: Record<string, string>;
  maxIterations?: number;
  rules?: PlanningRulesConfig;
  protectedCells?: Set<string>;
}): {
  draft: VplanScheduleDraft;
  log: VplanFixerLogEntry[];
  audit: VplanCoverageAuditReport;
  iterations: number;
  ok: boolean;
} {
  const rules = resolvePlanningRules(opts.rules ?? null);
  const log: VplanFixerLogEntry[] = [];
  const maxIter = opts.maxIterations ?? rules.solverMaxIterations;
  const hoursBaseline = sumBillableHours(opts.draft.assignments);
  const tolerance = rules.slaHoursTolerance ?? 8;

  const coverageGuard = buildCoverageGuard({
    protect: rules.protectCoverageOnEnforce,
    demand: opts.demand,
    positions: opts.positions,
    defaultPositionByEmp: opts.defaultPositionByEmp,
    dateStrList: opts.dateStrList,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
  });

  let assignments = [...opts.draft.assignments];
  let iter = 0;

  const bandGuard = guardIllegalBandTransitions({
    draft: { ...opts.draft, assignments },
    dateStrs: opts.dateStrList,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
    monthFirstDate: opts.dateStrList[0],
    minRestHoursBetweenBands: rules.minRestHoursBetweenBands,
    coverageGuard: rules.protectCoverageOnEnforce ? coverageGuard : undefined,
    protectedCells: opts.protectedCells,
  });
  assignments = bandGuard.draft.assignments;
  log.push(...bandGuard.log);

  const cctPass = enforceCctWorkRestPattern({
    draft: { ...opts.draft, assignments },
    dateStrs: opts.dateStrList,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
    rules,
    protectedCells: opts.protectedCells,
  });
  assignments = cctPass.draft.assignments;
  log.push(...cctPass.log);

  const rebound = runSafeCctRebound({
    draft: opts.draft,
    assignments,
    demand: opts.demand,
    positions: opts.positions,
    defaultPositionByEmp: opts.defaultPositionByEmp,
    dateStrs: opts.dateStrs,
    dateStrList: opts.dateStrList,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
    employeeNames: opts.employeeNames,
    rules,
    protectedCells: opts.protectedCells,
    maxIterations: maxIter,
  });
  assignments = rebound.assignments;
  log.push(...rebound.log);
  iter += rebound.iterations;

  const hoursAfterRebound = sumBillableHours(assignments);
  if (hoursAfterRebound < hoursBaseline - tolerance) {
    const filled = fillCoverageGaps(fillGapOpts({
      draft: opts.draft,
      assignments,
      dateStrs: opts.dateStrs,
      dateStrList: opts.dateStrList,
      positions: opts.positions,
      defaultPositionByEmp: opts.defaultPositionByEmp,
      cycle: opts.cycle,
      previousMonthAssignments: opts.previousMonthAssignments,
      rules,
      protectedCells: opts.protectedCells,
    }));
    if (filled.log.length > 0) {
      assignments = filled.draft.assignments;
      log.push(...filled.log);
      const rebound2 = runSafeCctRebound({
        draft: opts.draft,
        assignments,
        demand: opts.demand,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        dateStrs: opts.dateStrs,
        dateStrList: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        employeeNames: opts.employeeNames,
        rules,
        protectedCells: opts.protectedCells,
        maxIterations: Math.min(12, maxIter),
      });
      assignments = rebound2.assignments;
      log.push(...rebound2.log);
      iter += rebound2.iterations;
    }

    const recovered = sumBillableHours(assignments);
    if (recovered > hoursAfterRebound) {
      log.push({
        code: 'BILLABLE_RECOVERY',
        message: `Recuperadas ${Math.round(recovered - hoursAfterRebound)}h facturables (${Math.round(hoursAfterRebound)}→${Math.round(recovered)}h)`,
      });
    }
  }

  let audit = buildDetailedCoverageAudit({
    draft: { ...opts.draft, assignments },
    demand: opts.demand,
    positions: opts.positions,
    defaultPositionByEmp: opts.defaultPositionByEmp,
    dateStrs: opts.dateStrList,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
    employeeNames: opts.employeeNames,
    rules,
  });
  audit.iterationsUsed = iter;

  return {
    draft: { ...opts.draft, assignments },
    log,
    audit,
    iterations: iter,
    ok: audit.ok,
  };
}

/**
 * Reparación de mandato: solo cierre SLA (sin band guard ni CCT destructivo).
 */
export function runMandateCoverageRepair(opts: {
  draft: VplanScheduleDraft;
  demand: VplanDemandModel;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  dateStrs: Array<{ dateStr: string; dayLetter: string }>;
  dateStrList: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  employeeNames?: Record<string, string>;
  rules?: PlanningRulesConfig;
  protectedCells?: Set<string>;
  maxIterations?: number;
}): {
  draft: VplanScheduleDraft;
  log: VplanFixerLogEntry[];
  audit: VplanCoverageAuditReport;
} {
  const rules = resolvePlanningRules(opts.rules ?? null);
  const closure = runCoverageClosurePass({
    draft: opts.draft,
    assignments: [...opts.draft.assignments],
    demand: opts.demand,
    positions: opts.positions,
    defaultPositionByEmp: opts.defaultPositionByEmp,
    dateStrs: opts.dateStrs,
    dateStrList: opts.dateStrList,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
    employeeNames: opts.employeeNames,
    maxIterations: opts.maxIterations ?? rules.solverMaxIterations,
    rules,
    protectedCells: opts.protectedCells,
  });
  return {
    draft: { ...opts.draft, assignments: closure.assignments },
    log: closure.log,
    audit: closure.audit,
  };
}
