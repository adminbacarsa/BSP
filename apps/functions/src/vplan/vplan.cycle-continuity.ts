/**
 * VPLAN — continuidad de banda CCT 6+2 (CYCLE_24_MTN).
 *
 * Regla operativa: mínimo 12 h de descanso entre el fin de un turno y el inicio del siguiente.
 * Con ≥1 F intermedio cualquier par es válido.
 *
 * Ejemplos (horario CCT 07–15 / 15–23 / 23–07):
 *   M (día 1) → T (día 2): 24 h ✅
 *   N (día 1, sale 07:00 día 2) → T (día 2, 15:00): 8 h ❌
 *   T (día 1, 23:00) → M (día 2, 07:00): 8 h ❌
 */

import { trailingWorkFromPrevMonth, wouldExceedCctWorkStreak } from './vplan.cct-enforce';
import type { VplanExistingAssignment, VplanPlanningState } from './vplan.firestore';
import { isCustomFixedShiftPosition, isVirtualEmployeeId, type VplanPositionDef } from './vplan.positions';
import {
  billableHoursForCode,
  getCycleTemplate,
  is4x2Cycle,
  maxWorkStreak,
  normalizeCodeForCycle,
} from './vplan.cycle-templates';
import { resolveAssignmentBillableHours } from './vplan.assignment-hours';
import { maxRestStreak } from './vplan.rotation';
import type { VplanAssignment, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';
import type { CoverageGuardContext } from './vplan.coverage-guard';
import { wouldReduceCoverageByForcingFranco } from './vplan.coverage-guard';

export { CYCLE_24_MTN, CYCLE_12_DN } from './vplan.cycle-templates';

const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'E', 'A', 'PG', 'AA', 'RET', 'R', 'ESC', 'REF']);
/** Mínimo CCT entre turnos (12 h). Configurable vía `minRestHoursBetweenBands` en reglas. */
const DEFAULT_MIN_REST_HOURS = 12;

/** Horarios CCT estándar para validar descanso entre bandas. */
const BAND_SCHEDULE: Record<'M' | 'T' | 'N', { startMin: number; endMin: number }> = {
  M: { startMin: 7 * 60, endMin: 15 * 60 },
  T: { startMin: 15 * 60, endMin: 23 * 60 },
  /** Turno N del día D: 23:00 D → 07:00 D+1 */
  N: { startMin: 23 * 60, endMin: 7 * 60 },
};

function dateTimeMs(dateStr: string, minutesOfDay: number): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayOffset = Math.floor(minutesOfDay / (24 * 60));
  const modMin = ((minutesOfDay % (24 * 60)) + 24 * 60) % (24 * 60);
  return new Date(
    y,
    m - 1,
    d + dayOffset,
    Math.floor(modMin / 60),
    modMin % 60,
    0,
    0,
  ).getTime();
}

/** Instantánea de fin del turno según fecha de asignación en grilla. */
export function shiftEndMs(dateStr: string, band: 'M' | 'T' | 'N'): number {
  const sched = BAND_SCHEDULE[band];
  if (band === 'N') {
    return dateTimeMs(dateStr, sched.endMin + 24 * 60);
  }
  return dateTimeMs(dateStr, sched.endMin);
}

/** Instantánea de inicio del turno según fecha de asignación en grilla. */
export function shiftStartMs(dateStr: string, band: 'M' | 'T' | 'N'): number {
  return dateTimeMs(dateStr, BAND_SCHEDULE[band].startMin);
}

/**
 * Horas de descanso reales entre dos turnos asignados (pueden ser el mismo día calendario).
 */
export function restHoursBetweenShiftAssignments(
  prevDate: string,
  prev: 'M' | 'T' | 'N',
  nextDate: string,
  next: 'M' | 'T' | 'N',
): number {
  return (shiftStartMs(nextDate, next) - shiftEndMs(prevDate, prev)) / 3_600_000;
}

/** @deprecated Usar restHoursBetweenShiftAssignments con fechas reales. */
export function restHoursBetweenBands(prev: 'M' | 'T' | 'N', next: 'M' | 'T' | 'N'): number {
  return restHoursBetweenShiftAssignments('2000-01-01', prev, '2000-01-02', next);
}

export function workBand(code: string): 'M' | 'T' | 'N' | null {
  const c = code.toUpperCase();
  if (c === 'D12') return 'M';
  if (c === 'N12') return 'N';
  if (WORK_BANDS.has(c)) return c as 'M' | 'T' | 'N';
  return null;
}

export function isFrancoCode(code: string): boolean {
  return FRANCO_CODES.has(code.toUpperCase());
}

/**
 * ¿Transición ilegal por descanso insuficiente? (sin francos intermedios).
 */
export function isIllegalBandTransition(
  prev: 'M' | 'T' | 'N',
  next: 'M' | 'T' | 'N',
  minRestHours = DEFAULT_MIN_REST_HOURS,
  dates?: { prevDate: string; nextDate: string },
): boolean {
  return !transitionIsLegal(prev, next, 0, minRestHours, dates);
}

export function transitionIsLegal(
  prev: 'M' | 'T' | 'N',
  next: 'M' | 'T' | 'N',
  francosBetween: number,
  minRestHours = DEFAULT_MIN_REST_HOURS,
  dates?: { prevDate: string; nextDate: string },
): boolean {
  if (francosBetween >= 1) return true;
  if (prev === next) return true;
  const rest = dates
    ? restHoursBetweenShiftAssignments(dates.prevDate, prev, dates.nextDate, next)
    : restHoursBetweenBands(prev, next);
  return rest >= minRestHours;
}

function assignmentKey(empId: string, dateStr: string): string {
  return `${empId}_${dateStr}`;
}

export function expectedCycleCodeForEmployeeDay(
  opening: number,
  dayIndex: number,
  cycle: string,
  fixedBand?: string,
  skipFixedOverride = false,
): string {
  const template = getCycleTemplate(cycle);
  const raw = template[(opening + dayIndex) % template.length];
  if (is4x2Cycle(cycle)) return raw;
  if (
    !skipFixedOverride
    && fixedBand
    && WORK_BANDS.has(fixedBand)
    && WORK_BANDS.has(raw)
  ) {
    return fixedBand;
  }
  return raw;
}

function shouldSkipRealign(code: string): boolean {
  const c = code.toUpperCase();
  return ABSENCE_CODES.has(c) || isFrancoCode(c);
}

/**
 * Re-alinea códigos 24hs al ciclo desde opening slot del motor.
 * Empleados con racha del mes anterior no reciben override de banda fija.
 */
export function realignVplanDraftToCycle(opts: {
  draft: VplanScheduleDraft;
  dateStrs: string[];
  openingSlotByEmp: Record<string, number>;
  prevPlanningState: VplanPlanningState;
  defaultShiftByEmp?: Record<string, string>;
  useTrailing?: boolean;
  cycle?: string;
  protectedCells?: Set<string>;
}): { draft: VplanScheduleDraft; log: VplanFixerLogEntry[] } {
  const cycle = opts.cycle ?? '6+2';
  const template = getCycleTemplate(cycle);
  const log: VplanFixerLogEntry[] = [];
  const trailingEmpIds = new Set(Object.keys(opts.prevPlanningState.lastShiftByEmp || {}));
  const indexByKey = new Map<string, number>();

  opts.draft.assignments.forEach((a, i) => {
    indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i);
  });

  const assignments = opts.draft.assignments.map((a) => ({ ...a }));

  for (const [empId, opening] of Object.entries(opts.openingSlotByEmp)) {
    if (opening === undefined || opening === null) continue;
    const skipFixed = Boolean(opts.useTrailing && trailingEmpIds.has(empId));
    const fixedBand = opts.defaultShiftByEmp?.[empId]?.toUpperCase();

    opts.dateStrs.forEach((dateStr, di) => {
      const key = assignmentKey(empId, dateStr);
      if (opts.protectedCells?.has(key)) return;
      const idx = indexByKey.get(key);
      if (idx === undefined) return;

      const current = assignments[idx];
      if (shouldSkipRealign(current.code)) return;

      const expected = expectedCycleCodeForEmployeeDay(opening, di, cycle, fixedBand, skipFixed);
      if (current.code.toUpperCase() === expected) return;

      const prevCode = current.code;
      const hours = expected === 'F' ? 0 : billableHoursForCode(expected, cycle);
      assignments[idx] = {
        ...current,
        code: expected,
        hours,
        positionName: expected === 'F' ? '' : current.positionName,
      };
      log.push({
        code: 'CYCLE_REALIGN',
        message: `${prevCode} → ${expected} (slot ${opening}, día ${di + 1})`,
        employeeId: empId,
        dateStr,
      });
    });
  }

  return {
    draft: { ...opts.draft, assignments },
    log,
  };
}

/**
 * Protege celdas donde el guardia ya está en la banda/código que marca su ciclo (opening slot).
 * Evita que band-swap o escalera rompan M M M F F tras realinear.
 */
export function computeCycleAlignedWorkCells(opts: {
  assignments: VplanAssignment[];
  dateStrs: string[];
  openingSlotByEmp: Record<string, number>;
  prevPlanningState: VplanPlanningState;
  defaultShiftByEmp?: Record<string, string>;
  useTrailing?: boolean;
  cycle?: string;
}): Set<string> {
  const cycle = opts.cycle ?? '6+2';
  const aligned = new Set<string>();
  const trailingEmpIds = new Set(Object.keys(opts.prevPlanningState.lastShiftByEmp || {}));

  for (const [empId, opening] of Object.entries(opts.openingSlotByEmp)) {
    if (opening === undefined || opening === null) continue;
    const skipFixed = Boolean(opts.useTrailing && trailingEmpIds.has(empId));
    const fixedBand = opts.defaultShiftByEmp?.[empId]?.toUpperCase();

    opts.dateStrs.forEach((dateStr, dayIndex) => {
      const cell = opts.assignments.find(
        (a) => a.employeeId === empId && a.dateStr === dateStr,
      );
      if (!cell) return;

      const expected = expectedCycleCodeForEmployeeDay(
        opening,
        dayIndex,
        cycle,
        fixedBand,
        skipFixed,
      );
      const current = String(cell.code || '').toUpperCase();
      if (expected === 'F') {
        if (isFrancoCode(current)) aligned.add(assignmentKey(empId, dateStr));
        return;
      }
      if (current === expected) {
        aligned.add(assignmentKey(empId, dateStr));
      }
    });
  }

  return aligned;
}

function countFrancosBetween(
  byDate: Map<string, VplanAssignment>,
  fromDate: string,
  toDate: string,
): number {
  let count = 0;
  for (const [dateStr, a] of byDate) {
    if (dateStr <= fromDate || dateStr >= toDate) continue;
    if (isFrancoCode(a.code)) count += 1;
  }
  return count;
}

/** Francos estrictamente entre dos fechas (excluye extremos). */
export function countFrancosBetweenAssignments(
  assignments: VplanAssignment[],
  empId: string,
  fromDate: string,
  toDate: string,
): number {
  const byDate = new Map<string, VplanAssignment>();
  for (const a of assignments) {
    if (a.employeeId === empId) byDate.set(a.dateStr, a);
  }
  return countFrancosBetween(byDate, fromDate, toDate);
}

/** Reemplazo legal cuando el descanso entre turnos es insuficiente. */
function pickLegalBandReplacement(
  prev: 'M' | 'T' | 'N',
  illegalNext: 'M' | 'T' | 'N',
  prevDate: string,
  nextDate: string,
  francos: number,
  minRest: number,
): string {
  const candidates = [illegalNext, prev, 'F', 'M', 'T', 'N'];
  for (const candidate of candidates) {
    const band = workBand(candidate);
    if (!band) return 'F';
    if (transitionIsLegal(prev, band, francos, minRest, { prevDate, nextDate })) {
      return candidate;
    }
  }
  return 'F';
}

function applyBandFix(
  assignments: VplanAssignment[],
  indexByKey: Map<string, number>,
  byDate: Map<string, VplanAssignment>,
  empId: string,
  dateStr: string,
  replacement: string,
  log: VplanFixerLogEntry[],
  reason: string,
  opts?: {
    draftMeta: Pick<VplanScheduleDraft, 'sourceEngine'>;
    coverageGuard?: CoverageGuardContext & { protect: boolean };
    protectedCells?: Set<string>;
    cycle?: string;
  },
): void {
  const key = assignmentKey(empId, dateStr);
  if (opts?.protectedCells?.has(key)) {
    log.push({
      code: 'BAND_SKIP_PROTECTED',
      message: `${reason}: celda protegida (continuidad mes)`,
      employeeId: empId,
      dateStr,
    });
    return;
  }
  const idx = indexByKey.get(key);
  if (idx === undefined) return;

  const rep = replacement.toUpperCase();
  if (
    rep === 'F'
    && opts?.coverageGuard?.protect
    && wouldReduceCoverageByForcingFranco({
      assignments,
      draftMeta: opts.draftMeta,
      guard: opts.coverageGuard,
      empId,
      dateStr,
    })
  ) {
    log.push({
      code: 'BAND_DEFER_COVERAGE',
      message: `${reason}: fix diferido (protege slot SLA)`,
      employeeId: empId,
      dateStr,
    });
    return;
  }

  const prev = assignments[idx].code;
  assignments[idx] = {
    ...assignments[idx],
    code: replacement,
    hours: replacement === 'F' ? 0 : billableHoursForCode(replacement, opts?.cycle ?? '6+2'),
    positionName: replacement === 'F' ? '' : assignments[idx].positionName,
  };
  byDate.set(dateStr, assignments[idx]!);
  log.push({
    code: 'BAND_SKIP_ILLEGAL',
    message: `${reason}: ${prev} → ${replacement}`,
    employeeId: empId,
    dateStr,
  });
}

/**
 * Corrige saltos de banda ilegales sin al menos un F intermedio.
 */
export function guardIllegalBandTransitions(opts: {
  draft: VplanScheduleDraft;
  dateStrs: string[];
  openingSlotByEmp?: Record<string, number>;
  cycle?: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  monthFirstDate?: string;
  minRestHoursBetweenBands?: number;
  coverageGuard?: CoverageGuardContext & { protect: boolean };
  protectedCells?: Set<string>;
}): { draft: VplanScheduleDraft; log: VplanFixerLogEntry[] } {
  const cycle = opts.cycle ?? '6+2';
  const template = getCycleTemplate(cycle);
  const minRest = opts.minRestHoursBetweenBands ?? DEFAULT_MIN_REST_HOURS;
  const log: VplanFixerLogEntry[] = [];
  const byEmp = new Map<string, Map<string, VplanAssignment>>();

  for (const a of opts.draft.assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  const assignments = opts.draft.assignments.map((a) => ({ ...a }));
  const indexByKey = new Map<string, number>();
  assignments.forEach((a, i) => indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i));

  const prevByEmp = new Map<string, Map<string, VplanExistingAssignment>>();
  for (const a of opts.previousMonthAssignments ?? []) {
    if (!prevByEmp.has(a.employeeId)) prevByEmp.set(a.employeeId, new Map());
    prevByEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  function seedLastWorkFromPrevMonth(empId: string): {
    dateStr: string;
    band: 'M' | 'T' | 'N';
    code: string;
  } | null {
    const prevDays = prevByEmp.get(empId);
    if (!prevDays) return null;
    const dates = [...prevDays.keys()].sort().reverse();
    for (const d of dates) {
      const code = String(prevDays.get(d)?.code || '').toUpperCase();
      const band = workBand(code);
      if (band) return { dateStr: d, band, code };
    }
    return null;
  }

  for (const [empId, byDate] of byEmp) {
    let lastWork: { dateStr: string; band: 'M' | 'T' | 'N'; code: string } | null = null;
    const opening = opts.openingSlotByEmp?.[empId];
    const prevSeed = seedLastWorkFromPrevMonth(empId);

    for (const dateStr of opts.dateStrs) {
      const a = byDate.get(dateStr);
      if (!a) continue;

      const band = workBand(a.code);
      if (!band) continue;

      if (!lastWork && opts.monthFirstDate && dateStr === opts.monthFirstDate && prevSeed) {
        lastWork = prevSeed;
      }

      if (lastWork) {
        const isCrossMonth = Boolean(
          opts.monthFirstDate
          && lastWork.dateStr < opts.monthFirstDate
          && dateStr === opts.monthFirstDate,
        );
        const francos = isCrossMonth
          ? 0
          : countFrancosBetween(byDate, lastWork.dateStr, dateStr);

        if (!transitionIsLegal(lastWork.band, band, francos, minRest, {
          prevDate: lastWork.dateStr,
          nextDate: dateStr,
        })) {
          const di = opts.dateStrs.indexOf(dateStr);
          let replacement = pickLegalBandReplacement(
            lastWork.band,
            band,
            lastWork.dateStr,
            dateStr,
            francos,
            minRest,
          );
          if (opening !== undefined && di >= 0) {
            const fromTemplate = template[(opening + di) % template.length];
            const templateBand = workBand(fromTemplate);
            if (
              fromTemplate === 'F'
              || (templateBand && transitionIsLegal(lastWork.band, templateBand, francos, minRest, {
                prevDate: lastWork.dateStr,
                nextDate: dateStr,
              }))
            ) {
              replacement = fromTemplate;
            }
          }
          applyBandFix(
            assignments,
            indexByKey,
            byDate,
            empId,
            dateStr,
            replacement,
            log,
            `${lastWork.band}→${band} ilegal (${lastWork.dateStr}→${dateStr}, ${francos}F)`,
            {
              draftMeta: opts.draft,
              coverageGuard: opts.coverageGuard,
              protectedCells: opts.protectedCells,
              cycle,
            },
          );
          const fixedBand = workBand(replacement);
          if (fixedBand) {
            lastWork = { dateStr, band: fixedBand, code: replacement };
          }
          continue;
        }
      }

      lastWork = { dateStr, band, code: a.code };
    }
  }

  return {
    draft: { ...opts.draft, assignments },
    log,
  };
}

function codeOnPrevDay(
  byDate: Map<string, VplanExistingAssignment>,
  dateStr: string,
): string | undefined {
  const c = byDate.get(dateStr)?.code;
  return c ? String(c).toUpperCase() : undefined;
}

function addCalendarDay(dateStr: string): string | undefined {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  const dt = new Date(y, m - 1, d + 1, 12, 0, 0);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function addCalendarDayOffset(dateStr: string, offset: number): string | undefined {
  let cur = dateStr;
  for (let i = 0; i < offset; i++) {
    const next = addCalendarDay(cur);
    if (!next) return undefined;
    cur = next;
  }
  return cur;
}

export function protectedCellKey(empId: string, dateStr: string): string {
  return assignmentKey(empId, dateStr);
}

export type OpeningContinuityOpts = {
  previousMonthAssignments: VplanExistingAssignment[];
  prevMonthLastDate: string;
  monthFirstDate: string;
  prevPlanningState: VplanPlanningState;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  defaultShiftByEmp: Record<string, string>;
  cycle?: string;
  useTrailing: boolean;
  draftAssignments?: VplanAssignment[];
};

interface OpeningContinuityTarget {
  empId: string;
  dateStr: string;
  expectedCode: string;
  kind: 'continue' | 'close';
  lastAssignDate: string;
  lastCode: string;
  trailingWork: number;
  fixedPos: string;
  lastBand: 'M' | 'T' | 'N';
  offset: number;
  restOffset?: number;
  maxStreak: number;
  restDays: number;
}

function buildOpeningContinuityTargets(opts: OpeningContinuityOpts): OpeningContinuityTarget[] {
  if (!opts.useTrailing || !opts.prevMonthLastDate || !opts.monthFirstDate) {
    return [];
  }

  const cycle = opts.cycle ?? '6+2';
  const maxStreak = maxWorkStreak(cycle);
  const targets: OpeningContinuityTarget[] = [];

  const prevByEmp = new Map<string, Map<string, VplanExistingAssignment>>();
  for (const a of opts.previousMonthAssignments) {
    if (!prevByEmp.has(a.employeeId)) prevByEmp.set(a.employeeId, new Map());
    prevByEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  const draftAssignments = opts.draftAssignments ?? [];
  const indexByKey = new Map<string, number>();
  draftAssignments.forEach((a, i) => indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i));

  const empIds = new Set<string>([
    ...Object.keys(opts.prevPlanningState.lastShiftByEmp || {}),
    ...prevByEmp.keys(),
  ]);

  const customPosNames = new Set(
    opts.positions.filter((p) => isCustomFixedShiftPosition(p)).map((p) => p.positionName),
  );
  const isCustomEmployee = (empId: string): boolean => {
    const posName = opts.defaultPositionByEmp[empId];
    if (posName && customPosNames.has(posName)) return true;
    const idx = indexByKey.get(assignmentKey(empId, opts.monthFirstDate));
    if (idx === undefined) return false;
    const c = draftAssignments[idx]?.code?.toUpperCase() ?? '';
    return c === 'EN' || c === 'RO' || c === 'RON';
  };

  for (const empId of empIds) {
    if (isVirtualEmployeeId(empId)) continue;
    if (isCustomEmployee(empId)) continue;
    const prevDays = prevByEmp.get(empId);
    const prevEmpDates = prevDays ? [...prevDays.keys()].sort() : [];
    const lastAssignDate = prevEmpDates.length > 0
      ? prevEmpDates[prevEmpDates.length - 1]!
      : opts.prevMonthLastDate;

    let lastJunCode = prevDays
      ? codeOnPrevDay(prevDays, lastAssignDate)
      : undefined;
    if (!lastJunCode) {
      lastJunCode = opts.prevPlanningState.lastShiftByEmp?.[empId]?.toUpperCase();
    }
    if (!lastJunCode) continue;

    const lastCode = is4x2Cycle(cycle)
      ? normalizeCodeForCycle(lastJunCode, cycle)
      : lastJunCode;
    const lastBand = workBand(lastCode);
    if (!lastBand) continue;

    let trailingWork = trailingWorkFromPrevMonth(
      opts.previousMonthAssignments.filter((a) => a.employeeId === empId),
      empId,
      cycle,
    );
    if (trailingWork <= 0) {
      trailingWork = opts.prevPlanningState.trailingWorkDays?.[empId] ?? 0;
    }
    if (trailingWork <= 0 || trailingWork >= maxStreak) continue;

    const fixedBandRaw = opts.defaultShiftByEmp[empId]?.toUpperCase();
    const fixedBand = fixedBandRaw && workBand(fixedBandRaw) ? fixedBandRaw : undefined;
    let expectedCode: string;
    if (fixedBand) {
      if (lastBand !== workBand(fixedBand)) continue;
      expectedCode = fixedBand;
    } else {
      expectedCode = lastCode;
    }
    if (!isCycleWorkCode(expectedCode, cycle)) continue;

    const fixedPos = opts.defaultPositionByEmp[empId] || '';

    // Solo el 01 hereda banda de junio; del 02 en adelante manda cobertura SLA + CCT.
    targets.push({
      empId,
      dateStr: opts.monthFirstDate,
      expectedCode,
      kind: 'continue',
      lastAssignDate,
      lastCode,
      trailingWork,
      fixedPos,
      lastBand,
      offset: 0,
      maxStreak,
      restDays: maxRestStreak(cycle),
    });

    const workAfterOpenDay = trailingWork + 1;
    if (workAfterOpenDay >= maxStreak) {
      const restDays = maxRestStreak(cycle);
      for (let restOffset = 0; restOffset < restDays; restOffset++) {
        const closeDateStr = addCalendarDayOffset(opts.monthFirstDate, 1 + restOffset);
        if (!closeDateStr) break;
        targets.push({
          empId,
          dateStr: closeDateStr,
          expectedCode: 'F',
          kind: 'close',
          lastAssignDate,
          lastCode,
          trailingWork,
          fixedPos,
          lastBand,
          offset: 1 + restOffset,
          restOffset,
          maxStreak,
          restDays,
        });
      }
    }
  }

  return targets;
}

/** Celdas de continuidad jun→mes: solo el 01 del mes (banda trailing). El resto aplica CCT 6+2. */
export function computeOpeningProtectedCells(opts: OpeningContinuityOpts): Set<string> {
  return new Set(
    buildOpeningContinuityTargets(opts)
      .filter((t) => t.kind === 'continue' && t.offset === 0)
      .map((t) => assignmentKey(t.empId, t.dateStr)),
  );
}

/** Francos obligatorios tras cerrar racha de apertura — no reasignar en solver. */
export function computeOpeningRestProtectedCells(opts: OpeningContinuityOpts): Set<string> {
  return new Set(
    buildOpeningContinuityTargets(opts)
      .filter((t) => t.kind === 'close')
      .map((t) => assignmentKey(t.empId, t.dateStr)),
  );
}

/**
 * Corrige apertura del mes: solo el 01 hereda banda/racha de junio.
 * Del 02 en adelante la cobertura SLA + CCT definen M/T/N (como planificación manual).
 */
export function patchMonthOpeningContinuity(opts: {
  draft: VplanScheduleDraft;
  previousMonthAssignments: VplanExistingAssignment[];
  prevMonthLastDate: string;
  monthFirstDate: string;
  prevPlanningState: VplanPlanningState;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  defaultShiftByEmp: Record<string, string>;
  cycle?: string;
  useTrailing: boolean;
}): { draft: VplanScheduleDraft; log: VplanFixerLogEntry[] } {
  const log: VplanFixerLogEntry[] = [];
  const cycle = opts.cycle ?? '6+2';
  const targets = buildOpeningContinuityTargets({
    ...opts,
    draftAssignments: opts.draft.assignments,
  });

  if (targets.length === 0) {
    return { draft: opts.draft, log };
  }

  const assignments = opts.draft.assignments.map((a) => ({ ...a }));
  const indexByKey = new Map<string, number>();
  assignments.forEach((a, i) => indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i));

  for (const t of targets) {
    const idx = indexByKey.get(assignmentKey(t.empId, t.dateStr));
    if (idx === undefined) continue;

    const current = assignments[idx]!;
    const currentNorm = is4x2Cycle(cycle)
      ? normalizeCodeForCycle(current.code, cycle)
      : current.code.toUpperCase();

    if (t.kind === 'continue') {
      if (currentNorm === t.expectedCode) continue;
      if (!isCycleWorkCode(currentNorm, cycle) && currentNorm !== 'F') continue;

      assignments[idx] = {
        ...current,
        code: t.expectedCode,
        hours: t.expectedCode === 'F'
          ? 0
          : resolveAssignmentBillableHours(
            { ...current, code: t.expectedCode, positionName: t.fixedPos || current.positionName || '' },
            { cycle, positions: opts.positions },
          ),
        positionName: t.fixedPos || current.positionName || '',
      };
      log.push({
        code: 'MONTH_OPENING_STREAK_CONTINUE',
        message: `${t.lastAssignDate} ${t.lastCode} (racha ${t.trailingWork}+${t.offset + 1}) ${current.code} → ${t.expectedCode}`,
        employeeId: t.empId,
        dateStr: t.dateStr,
      });
      continue;
    }

    if (!isCycleWorkCode(currentNorm, cycle)) continue;

    assignments[idx] = {
      ...current,
      code: 'F',
      hours: 0,
      positionName: '',
    };
    log.push({
      code: 'MONTH_OPENING_STREAK_CLOSE',
      message: `Cierre bloque ${t.lastBand}×${t.maxStreak} (${(t.restOffset ?? 0) + 1}/${t.restDays}F) ${current.code} → F`,
      employeeId: t.empId,
      dateStr: t.dateStr,
    });
  }

  return {
    draft: { ...opts.draft, assignments },
    log,
  };
}

function isCycleWorkCode(code: string, cycle: string): boolean {
  const c = code.toUpperCase();
  if (is4x2Cycle(cycle)) return c === 'D12' || c === 'N12';
  return c === 'M' || c === 'T' || c === 'N';
}

function countTrailingWorkInBand(
  prevDays: Map<string, VplanExistingAssignment> | undefined,
  lastDate: string,
  band: 'M' | 'T' | 'N',
): number | undefined {
  if (!prevDays) return undefined;
  let work = 0;
  const dates = [...prevDays.keys()].filter((d) => d <= lastDate).sort().reverse();
  for (const d of dates) {
    const b = workBand(String(prevDays.get(d)?.code || ''));
    if (!b) break;
    if (b === band) work += 1;
    else if (work > 0) break;
  }
  return work > 0 ? work : undefined;
}

/** Jun→Jul: el primer día debe respetar la racha del último día del mes anterior. */
export function detectCrossMonthContinuityViolations(opts: {
  draft: VplanScheduleDraft;
  previousMonthAssignments: VplanExistingAssignment[];
  prevMonthLastDate: string;
  monthFirstDate: string;
  prevPlanningState: VplanPlanningState;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  cycle?: string;
}): Array<{
  employeeId: string;
  fromDate: string;
  toDate: string;
  fromCode: string;
  toCode: string;
  expectedCode: string;
}> {
  const cycle = opts.cycle ?? '6+2';
  const maxStreak = maxWorkStreak(cycle);
  const violations: Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    fromCode: string;
    toCode: string;
    expectedCode: string;
  }> = [];

  const prevByEmp = new Map<string, Map<string, VplanExistingAssignment>>();
  for (const a of opts.previousMonthAssignments) {
    if (!prevByEmp.has(a.employeeId)) prevByEmp.set(a.employeeId, new Map());
    prevByEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  const julByEmp = new Map<string, VplanAssignment>();
  for (const a of opts.draft.assignments) {
    if (a.dateStr === opts.monthFirstDate) julByEmp.set(a.employeeId, a);
  }

  const customPosNames = new Set(
    opts.positions.filter((p) => isCustomFixedShiftPosition(p)).map((p) => p.positionName),
  );

  const empIds = new Set<string>([
    ...prevByEmp.keys(),
    ...Object.keys(opts.prevPlanningState.lastShiftByEmp || {}),
  ]);

  for (const empId of empIds) {
    const prevDays = prevByEmp.get(empId);
    const prevEmpDates = prevDays ? [...prevDays.keys()].sort() : [];
    const lastAssignDate = prevEmpDates.length > 0
      ? prevEmpDates[prevEmpDates.length - 1]!
      : opts.prevMonthLastDate;

    const posName = opts.defaultPositionByEmp[empId];
    if (posName && customPosNames.has(posName)) continue;

    const jul1Row = julByEmp.get(empId);
    const julCodeCheck = jul1Row?.code?.toUpperCase() ?? '';
    if (julCodeCheck === 'EN' || julCodeCheck === 'RO' || julCodeCheck === 'RON') continue;

    let lastJun = prevDays?.get(lastAssignDate)?.code?.toUpperCase();
    if (!lastJun) {
      lastJun = opts.prevPlanningState.lastShiftByEmp?.[empId]?.toUpperCase();
    }
    if (!lastJun) continue;

    const lastCode = is4x2Cycle(cycle) ? normalizeCodeForCycle(lastJun, cycle) : lastJun;
    const lastBand = workBand(lastCode);
    if (!lastBand) continue;

    let trailingWork = trailingWorkFromPrevMonth(
      opts.previousMonthAssignments.filter((a) => a.employeeId === empId),
      empId,
      cycle,
    );
    if (trailingWork <= 0) {
      trailingWork = opts.prevPlanningState.trailingWorkDays?.[empId] ?? 0;
    }
    if (trailingWork <= 0 || trailingWork >= maxStreak) continue;

    const expectedCode = lastCode;
    if (!isCycleWorkCode(expectedCode, cycle)) continue;

    const julRow = julByEmp.get(empId);
    if (!julRow) continue;

    const julCode = is4x2Cycle(cycle)
      ? normalizeCodeForCycle(julRow.code, cycle)
      : julRow.code.toUpperCase();
    if (julCode === expectedCode) continue;
    if (!isCycleWorkCode(julCode, cycle) && julCode !== 'F') continue;

    if (julCode === 'F') {
      const monthDateStrs = [...new Set(opts.draft.assignments.map((a) => a.dateStr))].sort();
      const cct = wouldExceedCctWorkStreak({
        assignments: opts.draft.assignments,
        dateStrs: monthDateStrs,
        empId,
        dateStr: opts.monthFirstDate,
        shiftCode: expectedCode,
        cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
      });
      if (!cct.ok) continue;
    }

    violations.push({
      employeeId: empId,
      fromDate: lastAssignDate,
      toDate: opts.monthFirstDate,
      fromCode: lastJun,
      toCode: julRow.code,
      expectedCode,
    });
  }

  return violations;
}

/** Detecta violaciones de descanso mínimo entre turnos (fase verificación). */
export function detectIllegalBandTransitions(
  draft: VplanScheduleDraft,
  dateStrs: string[],
  minRestHours = DEFAULT_MIN_REST_HOURS,
): Array<{ employeeId: string; fromDate: string; toDate: string; fromCode: string; toCode: string }> {
  const violations: Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    fromCode: string;
    toCode: string;
  }> = [];

  const byEmp = new Map<string, Map<string, VplanAssignment>>();
  for (const a of draft.assignments) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, new Map());
    byEmp.get(a.employeeId)!.set(a.dateStr, a);
  }

  for (const [empId, byDate] of byEmp) {
    let lastWork: { dateStr: string; band: 'M' | 'T' | 'N'; code: string } | null = null;

    for (const dateStr of dateStrs) {
      const a = byDate.get(dateStr);
      if (!a) continue;

      const band = workBand(a.code);
      if (!band) continue;

      if (lastWork) {
        const francos = countFrancosBetween(byDate, lastWork.dateStr, dateStr);
        if (!transitionIsLegal(lastWork.band, band, francos, minRestHours, {
          prevDate: lastWork.dateStr,
          nextDate: dateStr,
        })) {
          violations.push({
            employeeId: empId,
            fromDate: lastWork.dateStr,
            toDate: dateStr,
            fromCode: lastWork.code,
            toCode: a.code,
          });
        }
      }

      lastWork = { dateStr, band, code: a.code };
    }
  }

  return violations;
}

/** Convierte turno ilegal por descanso entre bandas. Prefiere F en fromDate para conservar toDate. */
export function enforceIllegalBandRest(opts: {
  draft: VplanScheduleDraft;
  dateStrs: string[];
  minRestHours?: number;
  protectedCells?: Set<string>;
}): { draft: VplanScheduleDraft; log: VplanFixerLogEntry[] } {
  const log: VplanFixerLogEntry[] = [];
  const minRest = opts.minRestHours ?? DEFAULT_MIN_REST_HOURS;
  const assignments = opts.draft.assignments.map((a) => ({ ...a }));

  const fixedKeys = new Set<string>();
  let violations = detectIllegalBandTransitions(
    { ...opts.draft, assignments },
    opts.dateStrs,
    minRest,
  );

  while (violations.length > 0) {
    let progress = false;
    for (const v of violations) {
      const toKey = protectedCellKey(v.employeeId, v.toDate);
      if (fixedKeys.has(toKey)) continue;

      const fromIdx = assignments.findIndex(
        (a) => a.employeeId === v.employeeId && a.dateStr === v.fromDate,
      );
      const fromKey = protectedCellKey(v.employeeId, v.fromDate);
      const canFixFrom = fromIdx >= 0
        && !opts.protectedCells?.has(fromKey)
        && !fixedKeys.has(fromKey)
        && workBand(String(assignments[fromIdx]!.code || '')) !== null;

      if (canFixFrom) {
        const trial = assignments.map((a) => ({ ...a }));
        trial[fromIdx] = {
          ...trial[fromIdx]!,
          code: 'F',
          positionName: '',
          hours: 0,
        };
        const stillBad = detectIllegalBandTransitions(
          { ...opts.draft, assignments: trial },
          opts.dateStrs,
          minRest,
        ).some((x) => x.employeeId === v.employeeId && x.toDate === v.toDate);
        if (!stillBad) {
          assignments[fromIdx] = trial[fromIdx]!;
          log.push({
            code: 'BAND_REST_FIX_PRIOR',
            message: `${v.fromCode} → F (${v.fromCode} ${v.fromDate} → ${v.toCode} ${v.toDate} — libera ${v.toCode} ${v.toDate})`,
            employeeId: v.employeeId,
            dateStr: v.fromDate,
          });
          fixedKeys.add(fromKey);
          progress = true;
          continue;
        }
      }

      if (opts.protectedCells?.has(toKey)) continue;
      const toIdx = assignments.findIndex(
        (a) => a.employeeId === v.employeeId && a.dateStr === v.toDate,
      );
      if (toIdx < 0) continue;

      assignments[toIdx] = {
        ...assignments[toIdx]!,
        code: 'F',
        positionName: '',
        hours: 0,
      };
      log.push({
        code: 'BAND_REST_FIX',
        message: `${v.toCode} → F (descanso insuficiente ${v.fromCode} ${v.fromDate} → ${v.toCode} ${v.toDate})`,
        employeeId: v.employeeId,
        dateStr: v.toDate,
      });
      fixedKeys.add(toKey);
      progress = true;
    }

    if (!progress) break;
    violations = detectIllegalBandTransitions(
      { ...opts.draft, assignments },
      opts.dateStrs,
      minRest,
    );
  }

  return { draft: { ...opts.draft, assignments }, log };
}
