/**
 * VPLAN — enforcement estricto CCT (6+2, 4+2, 5+1, 6+1).
 * Semántica: 6+2 = 6 TURNOS + 2 FRANCOS (24h), no 6 días calendario.
 * Innegociable: 12h mínimo entre fin de turno e inicio del siguiente.
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
  shiftHoursForTurnCode,
  VPLAN_WORK_BLOCK_HOURS_STANDARD,
  VPLAN_WORK_BLOCK_HOURS_STRETCH,
} from './vplan.cycle-semantics';
import {
  wouldReduceCoverageByForcingFranco,
  type CoverageGuardContext,
} from './vplan.coverage-guard';
import { isVirtualEmployeeId } from './vplan.positions';
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

function resolveWorkBlockHoursCap(rules: ReturnType<typeof resolvePlanningRules>): {
  standard: number;
  stretch: number;
} {
  const stretch = rules.maxConsecutiveWorkHours ?? VPLAN_WORK_BLOCK_HOURS_STRETCH;
  return {
    standard: VPLAN_WORK_BLOCK_HOURS_STANDARD,
    stretch: Math.max(VPLAN_WORK_BLOCK_HOURS_STANDARD, stretch),
  };
}

function workHoursForCode(code: string, cycle: string): number {
  const c = code.toUpperCase();
  if (!isCycleWorkCode(c, cycle)) return 0;
  return shiftHoursForTurnCode(c);
}

/**
 * Días del mes donde el guardia debe estar en F (bloque descanso CCT pendiente).
 * Se calcula antes de la escalera para que no reasigne trabajo sobre francos obligatorios.
 */
export function computeMandatoryRestCells(opts: {
  assignments: VplanAssignment[];
  dateStrs: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  rules?: PlanningRulesConfig;
}): Set<string> {
  const rules = resolvePlanningRules(opts.rules ?? null);
  const cycle = opts.cycle;
  const maxWork = workDaysForCycle(cycle, rules);
  const maxRest = restDaysForCycle(cycle, rules);
  const blockCap = resolveWorkBlockHoursCap(rules);
  const mandatory = new Set<string>();

  const byEmp = new Map<string, Map<string, VplanAssignment>>();
  for (const a of opts.assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  const empIds = new Set(opts.assignments.map((a) => a.employeeId));

  for (const empId of empIds) {
    if (isVirtualEmployeeId(empId)) continue;

    let workRun = trailingWorkFromPrevMonth(opts.previousMonthAssignments, empId, cycle);
    let workHoursRun = 0;
    if (workRun > 0 && opts.previousMonthAssignments?.length) {
      const rows = opts.previousMonthAssignments
        .filter((a) => a.employeeId === empId)
        .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
      for (let i = rows.length - 1; i >= 0 && workHoursRun < blockCap.stretch; i--) {
        const c = String(rows[i]?.code || '').toUpperCase();
        if (isFranco(c) || isAbsence(c)) break;
        if (isCycleWorkCode(c, cycle)) workHoursRun += workHoursForCode(c, cycle);
        else break;
      }
    }

    let restPending = 0;
    const prevRest = trailingRestFromPrevMonth(opts.previousMonthAssignments, empId);
    if (workRun >= maxWork || workHoursRun >= blockCap.standard) {
      restPending = Math.max(0, maxRest - prevRest);
    }

    for (const dateStr of opts.dateStrs) {
      const cell = byEmp.get(empId)?.get(dateStr);
      const code = String(cell?.code || '').toUpperCase();

      if (restPending > 0) {
        mandatory.add(assignmentKey(empId, dateStr));
        if (isFranco(code) || isAbsence(code) || !code) {
          restPending -= 1;
          workRun = 0;
          workHoursRun = 0;
        }
        continue;
      }

      if (isCycleWorkCode(code, cycle)) {
        const h = workHoursForCode(code, cycle);
        workRun += 1;
        workHoursRun += h;
        if (workRun > maxWork || workHoursRun > blockCap.stretch) {
          restPending = maxRest;
        } else if (workRun >= maxWork || workHoursRun >= blockCap.standard) {
          restPending = maxRest;
        }
      } else if (isFranco(code) || isAbsence(code)) {
        workRun = 0;
        workHoursRun = 0;
      }
    }
  }

  return mandatory;
}

/** Convierte trabajo en días de descanso CCT obligatorio → F (prioridad sobre cobertura). */
export function enforceMandatoryRestCells(opts: {
  draft: VplanScheduleDraft;
  mandatoryCells: Set<string>;
  dateStrs: string[];
  cycle: string;
  skipCustomCodes?: Set<string>;
  protectedCells?: Set<string>;
}): { draft: VplanScheduleDraft; log: VplanFixerLogEntry[] } {
  const log: VplanFixerLogEntry[] = [];
  const customSkip = opts.skipCustomCodes ?? new Set(['EN', 'RO', 'RON']);
  const assignments = opts.draft.assignments.map((a) => ({ ...a }));

  for (let i = 0; i < assignments.length; i += 1) {
    const cell = assignments[i]!;
    const key = assignmentKey(cell.employeeId, cell.dateStr);
    if (!opts.mandatoryCells.has(key)) continue;
    if (opts.protectedCells?.has(key)) continue;
    const code = String(cell.code || '').toUpperCase();
    if (customSkip.has(code)) continue;
    if (!isCycleWorkCode(code, opts.cycle)) continue;

    assignments[i] = { ...cell, code: 'F', positionName: '', hours: 0 };
    log.push({
      code: 'CCT_MANDATORY_REST',
      message: `${code} → F (bloque descanso CCT obligatorio)`,
      employeeId: cell.employeeId,
      dateStr: cell.dateStr,
    });
  }

  return { draft: { ...opts.draft, assignments }, log };
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
  const blockCap = resolveWorkBlockHoursCap(rules);
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
    let workHoursRun = 0;
    if (workRun > 0 && opts.previousMonthAssignments?.length) {
      const rows = opts.previousMonthAssignments
        .filter((a) => a.employeeId === empId)
        .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
      for (let i = rows.length - 1; i >= 0 && workHoursRun < blockCap.stretch; i--) {
        const c = String(rows[i]?.code || '').toUpperCase();
        if (isFranco(c) || isAbsence(c)) break;
        if (isCycleWorkCode(c, cycle)) workHoursRun += workHoursForCode(c, cycle);
        else break;
      }
    }
    let restPending = 0;
    const prevRest = trailingRestFromPrevMonth(opts.previousMonthAssignments, empId);
    if (workRun >= maxWork || workHoursRun >= blockCap.standard) {
      restPending = Math.max(0, maxRest - prevRest);
    }

    for (const dateStr of opts.dateStrs) {
      const idxMap = byEmp.get(empId);
      const idx = idxMap?.get(dateStr);
      if (idx === undefined) continue;

      const cell = assignments[idx]!;
      let code = String(cell.code || '').toUpperCase();

      if (customSkip.has(code)) continue;

      if (restPending > 0) {
        if (isCycleWorkCode(code, cycle)) {
          if (!opts.protectedCells?.has(assignmentKey(empId, dateStr))) {
            assignments[idx] = { ...cell, code: 'F', positionName: '', hours: 0 };
            code = 'F';
            log.push({
              code: 'CCT_REST_BLOCK',
              message: `${cell.code} → F (descanso obligatorio ${maxRest}F tras bloque ${blockCap.standard}h, ${cycle})`,
              employeeId: empId,
              dateStr,
            });
          } else {
            log.push({
              code: 'CCT_REST_PROTECTED',
              message: `Celda protegida mantiene ${code} en bloque descanso (${dateStr})`,
              employeeId: empId,
              dateStr,
            });
            continue;
          }
        }
        if (isFranco(code) || isAbsence(code) || !code) {
          restPending -= 1;
          workRun = 0;
          workHoursRun = 0;
        }
        continue;
      }

      if (isCycleWorkCode(code, cycle)) {
        const turnH = workHoursForCode(code, cycle);
        workRun += 1;
        workHoursRun += turnH;
        const exceedsTurns = workRun > maxWork;
        const exceedsHours = workHoursRun > blockCap.stretch;
        if (exceedsTurns || exceedsHours) {
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
              message: `${code} → F (bloque >${maxWork} turnos o >${blockCap.stretch}h, ${cycle})`,
              employeeId: empId,
              dateStr,
            });
            workRun = 0;
            workHoursRun = 0;
            restPending = maxRest;
          } else {
            log.push({
              code: 'CCT_MAX_DEFER',
              message: `Preserva ${code} (${dateStr}) — cobertura > racha CCT`,
              employeeId: empId,
              dateStr,
            });
            workRun = maxWork;
          }
        } else if (workRun >= maxWork || workHoursRun >= blockCap.standard) {
          restPending = maxRest;
        }
      } else if (isFranco(code) || isAbsence(code)) {
        workRun = 0;
        workHoursRun = 0;
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
