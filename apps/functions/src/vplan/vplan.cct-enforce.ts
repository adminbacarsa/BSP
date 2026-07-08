/**
 * VPLAN — enforcement estricto CCT (6+2, 4+2, 5+1, 6+1).
 * Innegociable: M×6 → F×2 (6+2); D12×4 → F×2 (4+2); etc.
 */

import {
  restDaysForCycle,
  workDaysForCycle,
} from '../planning/planning-rules.defaults';
import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import { resolvePlanningRules } from '../planning/planning-rules.service';
import type { VplanExistingAssignment } from './vplan.firestore';
import { isCycleWorkCode } from './vplan.cycle-templates';
import {
  wouldReduceCoverageByForcingFranco,
  type CoverageGuardContext,
} from './vplan.coverage-guard';
import type { VplanAssignment, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';

const FRANCO = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE = new Set(['V', 'L', 'E', 'A', 'PG', 'AA']);

function isFranco(code: string): boolean {
  return FRANCO.has(code.toUpperCase());
}

function isAbsence(code: string): boolean {
  return ABSENCE.has(code.toUpperCase());
}

function assignmentKey(empId: string, dateStr: string): string {
  return `${empId}_${dateStr}`;
}

export function trailingWorkFromPrevMonth(
  prev: VplanExistingAssignment[] | undefined,
  empId: string,
  cycle: string,
): number {
  if (!prev?.length) return 0;
  const rows = prev
    .filter((a) => a.employeeId === empId)
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  let run = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const c = String(rows[i]?.code || '').toUpperCase();
    if (isFranco(c) || isAbsence(c)) break;
    if (isCycleWorkCode(c, cycle)) run += 1;
    else break;
  }
  return run;
}

export function trailingRestFromPrevMonth(
  prev: VplanExistingAssignment[] | undefined,
  empId: string,
): number {
  if (!prev?.length) return 0;
  const rows = prev
    .filter((a) => a.employeeId === empId)
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  let run = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const c = String(rows[i]?.code || '').toUpperCase();
    if (isFranco(c)) run += 1;
    else break;
  }
  return run;
}

/** ¿Asignar `shiftCode` en `dateStr` violaría el tope de racha CCT? */
export function wouldExceedCctWorkStreak(opts: {
  assignments: VplanAssignment[];
  dateStrs: string[];
  empId: string;
  dateStr: string;
  shiftCode: string;
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  rules?: PlanningRulesConfig;
  /** FT / cobertura urgente: permite trabajo en bloque de descanso CCT (no supera racha máx). */
  allowFrancoTrabajado?: boolean;
}): { ok: boolean; reason?: string } {
  const rules = resolvePlanningRules(opts.rules ?? null);
  const cycle = opts.cycle;
  const maxWork = workDaysForCycle(cycle, rules);
  const maxRest = restDaysForCycle(cycle, rules);
  const code = opts.shiftCode.toUpperCase();

  if (!isCycleWorkCode(code, cycle)) return { ok: true };

  const byDate = new Map<string, VplanAssignment>();
  for (const a of opts.assignments) {
    if (a.employeeId === opts.empId) byDate.set(a.dateStr, a);
  }

  let workRun = trailingWorkFromPrevMonth(opts.previousMonthAssignments, opts.empId, cycle);
  let restPending = 0;

  const prevRest = trailingRestFromPrevMonth(opts.previousMonthAssignments, opts.empId);
  if (workRun >= maxWork) {
    restPending = Math.max(0, maxRest - prevRest);
  }

  for (const d of opts.dateStrs) {
    const cell = d === opts.dateStr
      ? { code, positionName: '', employeeId: opts.empId, dateStr: d }
      : byDate.get(d);
    const c = String(cell?.code || '').toUpperCase();

    if (restPending > 0) {
      if (d === opts.dateStr && isCycleWorkCode(code, cycle)) {
        if (!opts.allowFrancoTrabajado) {
          return { ok: false, reason: `Bloque descanso CCT (${maxRest}F tras ${maxWork} trab)` };
        }
      }
      if (isFranco(c) || !c) restPending -= 1;
      else if (isCycleWorkCode(c, cycle)) restPending = maxRest;
      workRun = 0;
      continue;
    }

    if (isCycleWorkCode(c, cycle)) {
      workRun += 1;
      if (workRun > maxWork) {
        if (d === opts.dateStr) {
          return { ok: false, reason: `Supera racha máx ${maxWork} días trab (${cycle})` };
        }
      }
      if (workRun >= maxWork) restPending = maxRest;
    } else if (isFranco(c) || isAbsence(c)) {
      workRun = 0;
    }
  }

  return { ok: true };
}

/**
 * Fuerza patrón CCT: tras N días trab consecutivos → F×restBlock obligatorio.
 * Convierte el día (N+1)º de trabajo en F si no hubo descanso.
 */
export function enforceCctWorkRestPattern(opts: {
  draft: VplanScheduleDraft;
  dateStrs: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  skipCustomCodes?: Set<string>;
  rules?: PlanningRulesConfig;
  coverageGuard?: CoverageGuardContext & { protect: boolean };
  protectedCells?: Set<string>;
}): { draft: VplanScheduleDraft; log: VplanFixerLogEntry[] } {
  const log: VplanFixerLogEntry[] = [];
  const rules = resolvePlanningRules(opts.rules ?? null);
  const cycle = opts.cycle;
  const maxWork = workDaysForCycle(cycle, rules);
  const maxRest = restDaysForCycle(cycle, rules);
  const customSkip = opts.skipCustomCodes ?? new Set(['EN', 'RO', 'RON']);

  const byEmp = new Map<string, Map<string, number>>();
  const assignments = opts.draft.assignments.map((a) => ({ ...a }));
  assignments.forEach((a, i) => {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, i);
  });

  const empIds = new Set(assignments.map((a) => a.employeeId));

  for (const empId of empIds) {
    let workRun = trailingWorkFromPrevMonth(opts.previousMonthAssignments, empId, cycle);
    let restPending = 0;
    const prevRest = trailingRestFromPrevMonth(opts.previousMonthAssignments, empId);
    if (workRun >= maxWork) {
      restPending = Math.max(0, maxRest - prevRest);
    }

    for (const dateStr of opts.dateStrs) {
      const idxMap = byEmp.get(empId);
      const idx = idxMap?.get(dateStr);
      if (idx === undefined) continue;

      const cell = assignments[idx]!;
      const code = String(cell.code || '').toUpperCase();

      if (customSkip.has(code)) continue;

      if (restPending > 0) {
        if (isCycleWorkCode(code, cycle)) {
          const protectCoverage = opts.coverageGuard?.protect === true
            && wouldReduceCoverageByForcingFranco({
              assignments,
              draftMeta: opts.draft,
              guard: opts.coverageGuard,
              empId,
              dateStr,
            });
          if (!protectCoverage && !opts.protectedCells?.has(assignmentKey(empId, dateStr))) {
            assignments[idx] = { ...cell, code: 'F', positionName: '', hours: 0 };
            log.push({
              code: 'CCT_REST_BLOCK',
              message: `${code} → F (descanso obligatorio ${maxRest}F tras ${maxWork} trab, ${cycle})`,
              employeeId: empId,
              dateStr,
            });
          } else {
            log.push({
              code: 'CCT_REST_DEFER',
              message: `Preserva ${code} (${dateStr}) — cobertura/FT`,
              employeeId: empId,
              dateStr,
            });
          }
        }
        restPending -= 1;
        workRun = 0;
        continue;
      }

      if (isCycleWorkCode(code, cycle)) {
        workRun += 1;
        if (workRun > maxWork) {
          const protectCoverage = opts.coverageGuard?.protect === true
            && wouldReduceCoverageByForcingFranco({
              assignments,
              draftMeta: opts.draft,
              guard: opts.coverageGuard,
              empId,
              dateStr,
            });
          if (!protectCoverage && !opts.protectedCells?.has(assignmentKey(empId, dateStr))) {
            assignments[idx] = { ...cell, code: 'F', positionName: '', hours: 0 };
            log.push({
              code: 'CCT_MAX_WORK',
              message: `${code} → F (racha >${maxWork} días, ${cycle})`,
              employeeId: empId,
              dateStr,
            });
            workRun = 0;
            restPending = maxRest;
          } else {
            log.push({
              code: 'CCT_MAX_DEFER',
              message: `Preserva ${code} (${dateStr}) — cobertura > racha CCT`,
              employeeId: empId,
              dateStr,
            });
            // No arranca restPending: celda ya es trabajo que cubre SLA.
            workRun = maxWork;
          }
        } else if (workRun === maxWork) {
          restPending = maxRest;
        }
      } else if (isFranco(code) || isAbsence(code)) {
        workRun = 0;
      }
    }
  }

  return { draft: { ...opts.draft, assignments }, log };
}

export function detectCctStreakViolations(opts: {
  draft: VplanScheduleDraft;
  dateStrs: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  rules?: PlanningRulesConfig;
}): Array<{
  employeeId: string;
  fromDate: string;
  toDate: string;
  workDays: number;
  expectedRest: number;
}> {
  const violations: Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    workDays: number;
    expectedRest: number;
  }> = [];
  const rules = resolvePlanningRules(opts.rules ?? null);
  const maxWork = workDaysForCycle(opts.cycle, rules);
  const maxRest = restDaysForCycle(opts.cycle, rules);

  const byEmp = new Map<string, Map<string, VplanAssignment>>();
  for (const a of opts.draft.assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  for (const [empId, byDate] of byEmp) {
    let workRun = trailingWorkFromPrevMonth(opts.previousMonthAssignments, empId, opts.cycle);
    let streakStart = opts.dateStrs[0] ?? '';
    let restPending = 0;

    for (const dateStr of opts.dateStrs) {
      const code = String(byDate.get(dateStr)?.code || '').toUpperCase();

      if (restPending > 0 && isCycleWorkCode(code, opts.cycle)) {
        violations.push({
          employeeId: empId,
          fromDate: streakStart,
          toDate: dateStr,
          workDays: maxWork + 1,
          expectedRest: maxRest,
        });
        restPending = 0;
      }

      if (restPending > 0 && isFranco(code)) restPending -= 1;
      else if (restPending > 0 && isCycleWorkCode(code, opts.cycle)) restPending = maxRest;
      else if (restPending > 0) restPending = 0;

      if (isCycleWorkCode(code, opts.cycle)) {
        if (workRun === 0) streakStart = dateStr;
        workRun += 1;
        if (workRun === maxWork + 1) {
          violations.push({
            employeeId: empId,
            fromDate: streakStart,
            toDate: dateStr,
            workDays: workRun,
            expectedRest: maxRest,
          });
        }
        if (workRun >= maxWork) restPending = maxRest;
      } else if (isFranco(code)) {
        workRun = 0;
      }
    }
  }

  return violations;
}
