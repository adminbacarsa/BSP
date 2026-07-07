/**
 * Deriva trailing (racha fin de mes) desde turnos del mes anterior.
 * Fuente de verdad: grilla real (incluye draft:true del planificador).
 */

import type { VplanExistingAssignment } from './vplan.firestore';
import type { VplanPlanningState } from './vplan.firestore';
import { getCycleTemplate, is4x2Cycle, normalizeCodeForCycle } from './vplan.cycle-templates';

const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
const RET_CODES = new Set(['RET', 'R']);

function normBand(code: string): string {
  const c = code.toUpperCase();
  if (c === 'D12') return 'M';
  if (c === 'N12') return 'N';
  return c;
}

function isWorkBand(code: string): boolean {
  return WORK_BANDS.has(normBand(code));
}

function isFranco(code: string): boolean {
  return FRANCO_CODES.has(code.toUpperCase());
}

function isAbsence(code: string): boolean {
  return ABSENCE_CODES.has(code.toUpperCase());
}

function isRet(code: string): boolean {
  return RET_CODES.has(code.toUpperCase());
}

function codeOnDay(
  dayMap: Map<string, string>,
  dateStr: string,
): string | undefined {
  const c = dayMap.get(dateStr);
  return c ? String(c).toUpperCase() : undefined;
}

export function deriveTrailingFromAssignments(
  assignments: VplanExistingAssignment[],
  monthDateStrs: string[],
): Pick<
  VplanPlanningState,
  'trailingWorkDays' | 'trailingRestDays' | 'lastShiftByEmp' | 'lastWorkBandBeforeRest'
> {
  const byEmp = new Map<string, Map<string, string>>();
  for (const a of assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, String(a.code || '').toUpperCase());
  }

  const trailingWorkDays: Record<string, number> = {};
  const trailingRestDays: Record<string, number> = {};
  const lastShiftByEmp: Record<string, string> = {};
  const lastWorkBandBeforeRest: Record<string, string> = {};

  for (const [empId, dayMap] of byEmp) {
    const empDatesDesc = [...dayMap.keys()].sort().reverse();
    if (empDatesDesc.length === 0) continue;

    const lastDate = empDatesDesc[0]!;
    const lastCode = codeOnDay(dayMap, lastDate);
    if (!lastCode) continue;
    lastShiftByEmp[empId] = lastCode;

    if (isFranco(lastCode)) {
      let rest = 0;
      for (const d of empDatesDesc) {
        const c = codeOnDay(dayMap, d);
        if (!c || !isFranco(c)) break;
        rest += 1;
      }
      if (rest > 0) trailingRestDays[empId] = rest;

      for (const d of empDatesDesc) {
        const c = codeOnDay(dayMap, d);
        if (!c) continue;
        if (isFranco(c)) continue;
        if (isWorkBand(c)) {
          lastWorkBandBeforeRest[empId] = normBand(c);
          break;
        }
        break;
      }
      continue;
    }

    if (isAbsence(lastCode)) continue;

    if (isRet(lastCode)) {
      lastShiftByEmp[empId] = 'RET';
      let band: string | undefined;
      for (const d of empDatesDesc) {
        const c = codeOnDay(dayMap, d);
        if (!c) continue;
        if (isRet(c)) continue;
        if (isFranco(c) || isAbsence(c)) break;
        if (isWorkBand(c)) {
          band = normBand(c);
          break;
        }
        break;
      }
      if (band) {
        lastWorkBandBeforeRest[empId] = band;
        let work = 0;
        for (const d of empDatesDesc) {
          const c = codeOnDay(dayMap, d);
          if (!c) continue;
          if (isRet(c)) continue;
          if (isFranco(c) || isAbsence(c)) break;
          if (normBand(c) === band) work += 1;
          else if (isWorkBand(c)) break;
        }
        if (work > 0) trailingWorkDays[empId] = work;
      }
      continue;
    }

    if (isWorkBand(lastCode)) {
      const band = normBand(lastCode);
      let work = 0;
      for (const d of empDatesDesc) {
        const c = codeOnDay(dayMap, d);
        if (!c) break;
        if (isAbsence(c)) break;
        if (isFranco(c)) break;
        if (normBand(c) === band) work += 1;
        else if (isWorkBand(c)) break;
      }
      if (work > 0) trailingWorkDays[empId] = work;
    }
  }

  return {
    trailingWorkDays,
    trailingRestDays,
    lastShiftByEmp,
    lastWorkBandBeforeRest,
  };
}

export function planningStateHasTrailing(state: VplanPlanningState): boolean {
  return Boolean(
    (state.lastShiftByEmp && Object.keys(state.lastShiftByEmp).length > 0)
    || (state.trailingWorkDays && Object.keys(state.trailingWorkDays).length > 0),
  );
}

export function countTrailingEmployees(
  state: VplanPlanningState,
): number {
  const ids = new Set<string>();
  Object.keys(state.lastShiftByEmp || {}).forEach((id) => ids.add(id));
  Object.keys(state.trailingWorkDays || {}).forEach((id) => ids.add(id));
  return ids.size;
}

function dayOffsetFromAnchor(dateStr: string, anchorDateStr: string): number {
  const a = new Date(`${anchorDateStr}T12:00:00`).getTime();
  const b = new Date(`${dateStr}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Infiere opening slot (0..23) alineando el mes anterior al ciclo CYCLE_24_MTN.
 * Más robusto que inferCycleSlot cuando hay rachas largas o datos reales de grilla.
 */
export function inferOpeningSlotsFromMonthHistory(
  assignments: VplanExistingAssignment[],
  monthDateStrs: string[],
  targetMonthFirstDateStr: string,
  cycle = '6+2',
): Record<string, number> {
  const template = getCycleTemplate(cycle);
  const len = template.length;
  const byEmp = new Map<string, Array<{ dateStr: string; code: string }>>();
  for (const a of assignments) {
    if (!monthDateStrs.includes(a.dateStr)) continue;
    let code = String(a.code || '').toUpperCase();
    if (is4x2Cycle(cycle)) code = normalizeCodeForCycle(code, cycle);
    if (isAbsence(code)) continue;
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, []);
    byEmp.get(a.employeeId)!.push({ dateStr: a.dateStr, code });
  }

  const out: Record<string, number> = {};

  for (const [empId, rows] of byEmp) {
    if (rows.length === 0) continue;
    rows.sort((x, y) => x.dateStr.localeCompare(y.dateStr));

    const cycleRows = rows.filter((r) => isWorkBand(r.code) || isFranco(r.code));
    if (cycleRows.length < 3) continue;

    let bestSlot: number | null = null;
    let bestScore = -Infinity;

    for (let opening = 0; opening < len; opening++) {
      let score = 0;
      for (const row of cycleRows) {
        const offset = dayOffsetFromAnchor(row.dateStr, targetMonthFirstDateStr);
        const expected = template[(opening + offset + len * 200) % len];
        if (expected === row.code) {
          score += 3;
        } else if (isFranco(row.code) && expected === 'F') {
          score += 2;
        } else if (isWorkBand(row.code) && isWorkBand(expected)) {
          score -= 2;
        } else if (isFranco(row.code) || expected === 'F') {
          score -= 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestSlot = opening;
      }
    }

    const minScore = Math.max(6, Math.floor(cycleRows.length * 1.5));
    if (bestSlot !== null && bestScore >= minScore) {
      out[empId] = bestSlot;
    }
  }

  return out;
}

/** Turnos del mes anterior (incl. borrador) tienen prioridad sobre planificacion_estados. */
export function enrichPlanningStateWithTrailingFromTurnos(
  state: VplanPlanningState,
  prevAssignments: VplanExistingAssignment[],
  prevMonthDateStrs: string[],
): VplanPlanningState {
  if (prevAssignments.length === 0) return state;

  const derived = deriveTrailingFromAssignments(prevAssignments, prevMonthDateStrs);
  const hasDerived = planningStateHasTrailing({
    ...emptyTrailingState(),
    ...derived,
  });

  if (!hasDerived) return state;

  return {
    ...state,
    trailingWorkDays: { ...state.trailingWorkDays, ...derived.trailingWorkDays },
    trailingRestDays: { ...state.trailingRestDays, ...derived.trailingRestDays },
    lastShiftByEmp: { ...state.lastShiftByEmp, ...derived.lastShiftByEmp },
    lastWorkBandBeforeRest: {
      ...state.lastWorkBandBeforeRest,
      ...derived.lastWorkBandBeforeRest,
    },
  };
}

function emptyTrailingState(): VplanPlanningState {
  return { defaultPositionByEmp: {}, defaultShiftByEmp: {} };
}
