/**
 * Planificación de puestos custom (EN/RO L–V) y francos en días sin servicio.
 */

import { restDaysForCycle } from '../planning/planning-rules.defaults';
import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import { resolvePlanningRules } from '../planning/planning-rules.service';
import { evaluateCoverageCandidate } from './vplan.coverage-audit';
import { trailingRestFromPrevMonth } from './vplan.cct-enforce';
import { protectedCellKey } from './vplan.cycle-continuity';
import type { VplanExistingAssignment } from './vplan.firestore';
import { billableHoursForCode, isCycleWorkCode } from './vplan.cycle-templates';
import {
  isCustomFixedShiftPosition,
  isPositionActiveOnDay,
  primaryShiftCode,
  shiftBandHours,
  type VplanPositionDef,
} from './vplan.positions';
import { resolvePositionAssignees } from './vplan.sla-enforce';
import type { VplanAssignment, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';

function assignmentKey(empId: string, dateStr: string): string {
  return `${empId}_${dateStr}`;
}

/**
 * Fuerza EN/RO (y similares) solo en días activos del puesto; F en S/D u otros inactivos.
 */
export function enforceCustomPositionSchedules(opts: {
  draft: VplanScheduleDraft;
  dateStrs: Array<{ dateStr: string; dayLetter: string }>;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  absences?: Record<string, Set<string>>;
  openingSlotByEmp?: Record<string, number>;
}): { draft: VplanScheduleDraft; log: VplanFixerLogEntry[] } {
  const log: VplanFixerLogEntry[] = [];
  const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
  const customPositions = opts.positions.filter((p) => isCustomFixedShiftPosition(p));
  if (customPositions.length === 0) {
    return { draft: opts.draft, log };
  }

  const empToPos = resolvePositionAssignees({
    defaultPositionByEmp: opts.defaultPositionByEmp,
    positions: opts.positions,
    draftAssignments: opts.draft.assignments,
    onlyCustom: true,
  });

  const indexByKey = new Map<string, number>();
  const assignments = opts.draft.assignments.map((a, i) => {
    indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i);
    return { ...a };
  });

  for (const [empId, posName] of empToPos) {
    if (opts.openingSlotByEmp?.[empId] !== undefined) continue;

    const pos = posByName.get(posName);
    if (!pos || !isCustomFixedShiftPosition(pos)) continue;

    const shiftCode = primaryShiftCode(pos);
    const hours = shiftBandHours(pos.shifts[0] || { code: shiftCode });

    for (const { dateStr, dayLetter } of opts.dateStrs) {
      if (opts.absences?.[empId]?.has(dateStr)) continue;

      const key = assignmentKey(empId, dateStr);
      let idx = indexByKey.get(key);
      const active = isPositionActiveOnDay(pos, dayLetter);
      const expectedCode = active ? shiftCode : 'F';
      const expectedHours = active ? hours : 0;
      const expectedPos = active ? posName : '';

      if (idx === undefined) {
        assignments.push({
          employeeId: empId,
          dateStr,
          code: expectedCode,
          positionName: expectedPos,
          hours: expectedHours,
        });
        idx = assignments.length - 1;
        indexByKey.set(key, idx);
        log.push({
          code: 'CUSTOM_LV',
          message: `Creado ${expectedCode} (${posName}, ${dayLetter})`,
          employeeId: empId,
          dateStr,
        });
        continue;
      }

      const current = assignments[idx];
      if (
        current.code.toUpperCase() === expectedCode
        && (current.positionName || '') === expectedPos
      ) continue;

      log.push({
        code: 'CUSTOM_LV',
        message: `${current.code} → ${expectedCode} (${posName}, ${dayLetter})`,
        employeeId: empId,
        dateStr,
      });
      assignments[idx] = {
        ...current,
        code: expectedCode,
        positionName: expectedPos,
        hours: expectedHours,
      };
    }
  }

  return {
    draft: { ...opts.draft, assignments },
    log,
  };
}

/**
 * Detecta rachas de trabajo > maxWorkDays sin franco (ej. 6+2 → máx 6).
 */
export function detectOverlongWorkStreaks(
  draft: VplanScheduleDraft,
  dateStrs: string[],
  maxWorkDays = 6,
): Array<{ employeeId: string; band: string; fromDate: string; toDate: string; days: number }> {
  const violations: Array<{
    employeeId: string;
    band: string;
    fromDate: string;
    toDate: string;
    days: number;
  }> = [];

  const byEmp = new Map<string, Map<string, VplanAssignment>>();
  for (const a of draft.assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  const FRANCO = new Set(['F', 'FF', 'FP', 'FT']);
  const WORK = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO']);

  for (const [empId, byDate] of byEmp) {
    let streakStart = '';
    let streakLen = 0;

    for (const dateStr of dateStrs) {
      const a = byDate.get(dateStr);
      const code = a?.code?.toUpperCase() || '';
      const isWork = WORK.has(code);
      const isFranco = FRANCO.has(code);

      if (isWork) {
        if (streakLen === 0) streakStart = dateStr;
        streakLen += 1;
      } else if (isFranco || !code) {
        if (streakLen > maxWorkDays) {
          violations.push({
            employeeId: empId,
            band: byDate.get(streakStart)?.code?.toUpperCase() || '?',
            fromDate: streakStart,
            toDate: dateStrs[dateStrs.indexOf(dateStr) - 1] || dateStr,
            days: streakLen,
          });
        }
        streakLen = 0;
        streakStart = '';
      }

      if (dateStr === dateStrs[dateStrs.length - 1] && streakLen > maxWorkDays) {
        violations.push({
          employeeId: empId,
          band: byDate.get(streakStart)?.code?.toUpperCase() || '?',
          fromDate: streakStart,
          toDate: dateStr,
          days: streakLen,
        });
      }
    }
  }

  return violations;
}

const REST_BREAK = new Set(['F', 'FF', 'FP', 'FT']);
const NON_BILLABLE_BREAK = new Set(['RET', 'R', 'V', 'L', 'A', 'E', 'AA', 'PG']);

/**
 * Alerta CCT: horas facturables acumuladas sin día de descanso (ej. 7×8h = 56h).
 */
export function detectConsecutiveBillableHoursViolations(
  draft: VplanScheduleDraft,
  dateStrs: string[],
  maxHours: number,
): Array<{ employeeId: string; fromDate: string; toDate: string; hours: number }> {
  const violations: Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    hours: number;
  }> = [];

  const byEmp = new Map<string, Map<string, VplanAssignment>>();
  for (const a of draft.assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  for (const [empId, byDate] of byEmp) {
    let streakStart = '';
    let streakHours = 0;

    const flushIfOver = (toDate: string) => {
      if (streakHours > maxHours) {
        violations.push({
          employeeId: empId,
          fromDate: streakStart,
          toDate,
          hours: streakHours,
        });
      }
    };

    const resetStreak = () => {
      streakStart = '';
      streakHours = 0;
    };

    for (const dateStr of dateStrs) {
      const a = byDate.get(dateStr);
      const code = a?.code?.toUpperCase() || '';
      const billable = a?.hours ?? billableHoursForCode(code);

      if (billable > 0 && !REST_BREAK.has(code) && !NON_BILLABLE_BREAK.has(code)) {
        if (streakHours === 0) streakStart = dateStr;
        streakHours += billable;
        flushIfOver(dateStr);
      } else if (REST_BREAK.has(code) || billable <= 0 || NON_BILLABLE_BREAK.has(code)) {
        resetStreak();
      }
    }

    if (streakHours > maxHours && streakStart) {
      const lastDate = dateStrs[dateStrs.length - 1] ?? streakStart;
      violations.push({
        employeeId: empId,
        fromDate: streakStart,
        toDate: lastDate,
        hours: streakHours,
      });
    }
  }

  return violations;
}

const FRANCO_SET = new Set(['F', 'FF', 'FP', 'FT']);

function isFrancoCode(code: string): boolean {
  return FRANCO_SET.has(code.toUpperCase());
}

/** Guardia en puesto custom (RO/EN): no puede cubrir huecos 24hs vía pool. */
export function isCustomEmployeeCrossAssignable(opts: {
  empId: string;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
}): boolean {
  const posName = String(opts.defaultPositionByEmp[opts.empId] || '').trim();
  if (!posName) return true;
  const pos = opts.positions.find((p) => p.positionName === posName);
  if (!pos) return true;
  return !isCustomFixedShiftPosition(pos);
}

/** Celdas protegidas: la escalera/audit no puede pisar RO L–V ni F S/D. */
export function computeCustomScheduleProtectedCells(opts: {
  dateStrs: Array<{ dateStr: string; dayLetter: string }>;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  draftAssignments?: VplanAssignment[];
}): Set<string> {
  const protectedCells = new Set<string>();
  const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
  const empToPos = resolvePositionAssignees({
    defaultPositionByEmp: opts.defaultPositionByEmp,
    positions: opts.positions,
    draftAssignments: opts.draftAssignments,
    onlyCustom: true,
  });

  for (const [empId, posName] of empToPos) {
    const pos = posByName.get(posName);
    if (!pos || !isCustomFixedShiftPosition(pos)) continue;
    for (const { dateStr, dayLetter } of opts.dateStrs) {
      if (!isPositionActiveOnDay(pos, dayLetter)) {
        protectedCells.add(protectedCellKey(empId, dateStr));
      }
    }
  }

  return protectedCells;
}

export function detectCustomScheduleViolations(opts: {
  draft: VplanScheduleDraft;
  dateStrs: Array<{ dateStr: string; dayLetter: string }>;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
}): Array<{ employeeId: string; dateStr: string; expectedCode: string; actualCode: string; positionName: string }> {
  const violations: Array<{
    employeeId: string;
    dateStr: string;
    expectedCode: string;
    actualCode: string;
    positionName: string;
  }> = [];

  const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
  const empToPos = resolvePositionAssignees({
    defaultPositionByEmp: opts.defaultPositionByEmp,
    positions: opts.positions,
    draftAssignments: opts.draft.assignments,
    onlyCustom: true,
  });

  const byEmp = new Map<string, Map<string, VplanAssignment>>();
  for (const a of opts.draft.assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  for (const [empId, posName] of empToPos) {
    const pos = posByName.get(posName);
    if (!pos || !isCustomFixedShiftPosition(pos)) continue;
    const shiftCode = primaryShiftCode(pos);

    for (const { dateStr, dayLetter } of opts.dateStrs) {
      const active = isPositionActiveOnDay(pos, dayLetter);
      const expectedCode = active ? shiftCode : 'F';
      const cell = byEmp.get(empId)?.get(dateStr);
      const actualCode = String(cell?.code || 'F').toUpperCase();
      if (actualCode === expectedCode) continue;
      if (!active && isFrancoCode(actualCode) && actualCode !== 'F') continue;
      violations.push({
        employeeId: empId,
        dateStr,
        expectedCode,
        actualCode,
        positionName: posName,
      });
    }
  }

  return violations;
}

export function detectOverlongRestStreaks(
  draft: VplanScheduleDraft,
  dateStrs: string[],
  cycle: string,
  previousMonthAssignments?: VplanExistingAssignment[],
  rules?: PlanningRulesConfig,
): Array<{ employeeId: string; fromDate: string; toDate: string; restDays: number; maxRest: number }> {
  const resolved = resolvePlanningRules(rules ?? null);
  const maxRest = restDaysForCycle(cycle, resolved);
  const violations: Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    restDays: number;
    maxRest: number;
  }> = [];

  const byEmp = new Map<string, Map<string, VplanAssignment>>();
  for (const a of draft.assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  const empIds = new Set(draft.assignments.map((a) => a.employeeId));

  for (const empId of empIds) {
    let restRun = trailingRestFromPrevMonth(previousMonthAssignments, empId);
    let streakStart = '';

    for (const dateStr of dateStrs) {
      const code = String(byEmp.get(empId)?.get(dateStr)?.code || 'F').toUpperCase();
      if (isFrancoCode(code) || !code) {
        if (restRun === 0) streakStart = dateStr;
        restRun += 1;
        if (restRun > maxRest) {
          violations.push({
            employeeId: empId,
            fromDate: streakStart,
            toDate: dateStr,
            restDays: restRun,
            maxRest,
          });
        }
      } else {
        restRun = 0;
        streakStart = '';
      }
    }
  }

  return violations;
}

/**
 * Recorta rachas F > restDays (6+2 → máx 2F). Convierte F excedente en trabajo legal.
 * No toca celdas protegidas ni francos de puestos custom (RO/EN).
 */
export function enforceMaxRestStreak(opts: {
  draft: VplanScheduleDraft;
  dateStrs: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  rules?: PlanningRulesConfig;
  protectedCells?: Set<string>;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  defaultShiftByEmp?: Record<string, string>;
}): { draft: VplanScheduleDraft; log: VplanFixerLogEntry[] } {
  const log: VplanFixerLogEntry[] = [];
  const rules = resolvePlanningRules(opts.rules ?? null);
  const maxRest = restDaysForCycle(opts.cycle, rules);
  const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));

  const customEmpIds = new Set(resolvePositionAssignees({
    defaultPositionByEmp: opts.defaultPositionByEmp,
    positions: opts.positions,
    draftAssignments: opts.draft.assignments,
    onlyCustom: true,
  }).keys());

  const assignments = opts.draft.assignments.map((a) => ({ ...a }));
  const indexByKey = new Map<string, number>();
  assignments.forEach((a, i) => indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i));

  const shiftCandidatesFor = (empId: string): string[] => {
    const preferred = String(opts.defaultShiftByEmp?.[empId] || '').toUpperCase();
    const pool = preferred ? [preferred, 'M', 'T', 'N'] : ['M', 'T', 'N'];
    return [...new Set(pool.filter((c) => isCycleWorkCode(c, opts.cycle)))];
  };

  const empIds = new Set(assignments.map((a) => a.employeeId));

  for (const empId of empIds) {
    if (customEmpIds.has(empId)) continue;

    let restRun = trailingRestFromPrevMonth(opts.previousMonthAssignments, empId);

    for (const dateStr of opts.dateStrs) {
      const key = assignmentKey(empId, dateStr);
      const idx = indexByKey.get(key);
      if (idx === undefined) continue;

      const cell = assignments[idx]!;
      const code = String(cell.code || 'F').toUpperCase();

      if (!isFrancoCode(code)) {
        restRun = 0;
        continue;
      }

      restRun += 1;
      if (restRun <= maxRest) continue;
      if (opts.protectedCells?.has(protectedCellKey(empId, dateStr))) continue;

      const defaultPos = String(opts.defaultPositionByEmp[empId] || '').trim();
      const pos = defaultPos ? posByName.get(defaultPos) : undefined;
      if (pos && isCustomFixedShiftPosition(pos)) continue;

      let picked: string | null = null;
      for (const shiftCode of shiftCandidatesFor(empId)) {
        const evalResult = evaluateCoverageCandidate({
          empId,
          dateStr,
          shiftCode,
          assignments,
          dateStrs: opts.dateStrs,
          cycle: opts.cycle,
          previousMonthAssignments: opts.previousMonthAssignments,
          rules,
        });
        if (evalResult.canAssign) {
          picked = shiftCode;
          break;
        }
      }
      if (!picked) continue;

      assignments[idx] = {
        ...cell,
        code: picked,
        positionName: defaultPos,
        hours: billableHoursForCode(picked),
      };
      log.push({
        code: 'CCT_TRIM_REST',
        message: `F → ${picked} (racha F>${maxRest}, ${opts.cycle})`,
        employeeId: empId,
        dateStr,
      });
      restRun = 0;
    }
  }

  return { draft: { ...opts.draft, assignments }, log };
}
