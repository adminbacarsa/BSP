/**
 * Generación 4+2 (D12/N12) para puestos 24hs en VPLAN.
 * autoScheduleEngine embebido solo produce M/T/N; este módulo genera el cronograma 12h.
 */

import type { EngineContext } from '../scheduling/autoScheduleEngine';
import {
  bandZoneForSlot,
  billableHoursForCode,
  coldStartOpenings,
  CYCLE_12_DN,
  cycleLength,
  getCycleTemplate,
  inferTrailingOpeningSlots,
  is4x2Cycle,
  isCycleWorkCode,
  isFrancoCycleCode,
  normalizeCodeForCycle,
  subgroupSize,
} from './vplan.cycle-templates';
import { getRotationProfile } from './vplan.rotation';
import type { VplanPlanningState, VplanExistingAssignment } from './vplan.firestore';
import { inferOpeningSlotsFromMonthHistory } from './vplan.trailing';
import type { VplanPositionDef } from './vplan.positions';
import { is24hsPosition } from './vplan.positions';
import type { VplanAssignment, VplanFixerLogEntry } from './vplan.types';

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

function dayLetter(dateStr: string): string {
  return DAY_LETTERS[new Date(`${dateStr}T12:00:00`).getDay()];
}

function isActiveDay(pos: VplanPositionDef, dayLetterStr: string): boolean {
  const days = pos.activeDays;
  if (!days || days.length >= 7) return true;
  return days.includes(dayLetterStr);
}

function inferOpeningSlot12(
  lastCode: string | undefined,
  trailingWork?: number,
  trailingRest?: number,
): number | null {
  if (!lastCode) return null;
  const code = normalizeCodeForCycle(lastCode, '4+2');

  for (let day1 = 0; day1 < 12; day1++) {
    const prevDay = (day1 - 1 + 12) % 12;
    if (CYCLE_12_DN[prevDay] !== code) continue;

    if (isCycleWorkCode(code, '4+2')) {
      const need = Math.max(1, trailingWork ?? 1);
      let ok = 0;
      for (let b = 0; b < need; b++) {
        if (CYCLE_12_DN[(prevDay - b + 12) % 12] !== code) break;
        ok += 1;
      }
      if (ok >= need) return day1;
    } else if (isFrancoCycleCode(code)) {
      const need = Math.max(1, trailingRest ?? 1);
      let ok = 0;
      for (let b = 0; b < need; b++) {
        if (CYCLE_12_DN[(prevDay - b + 12) % 12] !== 'F') break;
        ok += 1;
      }
      if (ok < need) continue;
      if (need === 1 && CYCLE_12_DN[day1] !== 'F') continue;
      if (need >= 2 && !isCycleWorkCode(CYCLE_12_DN[day1], '4+2')) continue;
      return day1;
    }
  }
  return null;
}

function resolveOpeningSlots12(
  ctx: Pick<EngineContext, 'defaultShiftByEmp' | 'prevMonthLastShiftByEmp' | 'prevMonthTrailingWorkDays' | 'prevMonthTrailingRestDays'>,
  subgroups: string[][],
): Record<string, number> {
  const out: Record<string, number> = {};
  const cold = coldStartOpenings('4+2');
  const ZONE_SLOT: Record<string, number> = { D12: 2, N12: 6, F: 10 };

  for (const groupIds of subgroups) {
    const regularIds = groupIds.slice(0, subgroupSize('4+2'));
    const withTrail: string[] = [];
    const withoutTrail: string[] = [];

    for (const empId of regularIds) {
      const slot = inferOpeningSlot12(
        ctx.prevMonthLastShiftByEmp?.[empId],
        ctx.prevMonthTrailingWorkDays?.[empId],
        ctx.prevMonthTrailingRestDays?.[empId],
      );
      if (slot !== null) {
        out[empId] = slot;
        withTrail.push(empId);
      } else {
        withoutTrail.push(empId);
      }
    }

    const usedZones = new Set<string>();
    for (const empId of [...withTrail]) {
      const zone = bandZoneForSlot(out[empId], '4+2');
      if (!usedZones.has(zone)) usedZones.add(zone);
      else {
        delete out[empId];
        withoutTrail.push(empId);
      }
    }

    const firstTrail = withTrail.find((id) => out[id] !== undefined);
    const anchor = firstTrail !== undefined ? out[firstTrail] : cold[0];
    const canonicalForZone: Record<string, number> = {};
    for (let k = 0; k < 3; k++) {
      const s = ((anchor + k * 4) % 12 + 12) % 12;
      const z = bandZoneForSlot(s, '4+2');
      if (!(z in canonicalForZone)) canonicalForZone[z] = s;
    }

    for (const empId of withTrail) {
      if (out[empId] === undefined) continue;
      const zone = bandZoneForSlot(out[empId], '4+2');
      const c = canonicalForZone[zone];
      if (c !== undefined) out[empId] = c;
    }

    const ALL_ZONES = ['D12', 'N12', 'F'];
    const available = new Set(ALL_ZONES.filter((z) => !usedZones.has(z)));
    withoutTrail.forEach((empId, i) => {
      const fixed = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
      let zone = ALL_ZONES[i % 3];
      if (fixed === 'D12' || fixed === 'M' || fixed === 'T') zone = 'D12';
      else if (fixed === 'N12' || fixed === 'N') zone = 'N12';
      else if (available.size > 0) zone = [...available][0];
      available.delete(zone);
      out[empId] = canonicalForZone[zone] ?? ZONE_SLOT[zone] ?? cold[i % cold.length];
    });

    groupIds.slice(subgroupSize('4+2')).forEach((empId, fi) => {
      const slot = inferOpeningSlot12(
        ctx.prevMonthLastShiftByEmp?.[empId],
        ctx.prevMonthTrailingWorkDays?.[empId],
        ctx.prevMonthTrailingRestDays?.[empId],
      );
      out[empId] = slot ?? cold[fi % cold.length];
    });
  }

  return out;
}

function buildSubgroups(
  positionGroups: Record<string, string[]>,
  positions: VplanPositionDef[],
  cycle: string,
): VplanSubgroupMeta[] {
  const result: VplanSubgroupMeta[] = [];
  const size = subgroupSize(cycle);

  for (const [posName, groupIds] of Object.entries(positionGroups)) {
    const pos = positions.find((p) => p.positionName === posName);
    if (!pos || !is24hsPosition(pos)) continue;
    if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7) continue;

    const qty = Math.max(1, pos.qty);
    const subgroupCount = Math.min(qty, Math.floor(groupIds.length / size));
    if (subgroupCount === 0) continue;

    for (let i = 0; i < subgroupCount; i++) {
      const core = groupIds.slice(i * size, i * size + size);
      result.push({
        positionName: posName,
        subgroupIndex: i,
        subgroupCount,
        employeeIds: [...core],
      });
    }

    const floaters = groupIds.slice(subgroupCount * size);
    floaters.forEach((id, fi) => {
      const target = result[fi % subgroupCount];
      if (target) target.employeeIds.push(id);
    });
  }

  return result;
}

export interface VplanSubgroupMeta {
  positionName: string;
  subgroupIndex: number;
  subgroupCount: number;
  employeeIds: string[];
}

/** Evita que varios guardias del mismo subgrupo compartan opening (cluster de F). */
function spreadCollidingOpeningSlots(
  slots: Record<string, number>,
  employeeIds: string[],
  cycle: string,
): void {
  const len = cycleLength(cycle);
  const bySlot = new Map<number, string[]>();

  for (const empId of employeeIds) {
    const s = slots[empId];
    if (s === undefined) continue;
    if (!bySlot.has(s)) bySlot.set(s, []);
    bySlot.get(s)!.push(empId);
  }

  for (const [baseSlot, emps] of bySlot) {
    if (emps.length <= 1) continue;
    emps.forEach((empId, i) => {
      slots[empId] = ((baseSlot + i) % len + len) % len;
    });
  }
}

function subgroupPhaseOffset(cycle: string, subgroupIndex: number, subgroupCount: number): number {
  if (subgroupCount <= 1 || subgroupIndex === 0) return 0;
  const profile = getRotationProfile(cycle);
  return subgroupIndex * profile.workersPerDay;
}

/**
 * Prioridad: motor (cobertura subgrupo) + ancla trailing por subgrupo.
 * Nunca pisa slots individuales — eso rompe 1M+1T+1N+1F por día.
 */
export function resolveOpeningSlotsForVplan(opts: {
  cycle: string;
  prevPlanningState: VplanPlanningState;
  prevAssignments: VplanExistingAssignment[];
  prevMonthDateStrs: string[];
  monthFirstDate: string;
  engineSlots: Record<string, number>;
  useTrailing: boolean;
  positionGroups: Record<string, string[]>;
  positions: VplanPositionDef[];
}): { slots: Record<string, number>; trailingCount: number; historyCount: number } {
  const trailingSlots = opts.useTrailing
    ? inferTrailingOpeningSlots(opts.prevPlanningState, opts.cycle)
    : {};

  const len = getCycleTemplate(opts.cycle).length;
  const stagger = is4x2Cycle(opts.cycle) ? 4 : 6;
  const size = subgroupSize(opts.cycle);
  const cold = coldStartOpenings(opts.cycle);
  const subgroups = buildSubgroups(opts.positionGroups, opts.positions, opts.cycle);

  const out: Record<string, number> = { ...opts.engineSlots };
  let trailingAnchors = 0;

  for (const subgroup of subgroups) {
    const regular = subgroup.employeeIds.slice(0, size);
    const floaters = subgroup.employeeIds.slice(size);
    const sgOffset = subgroupPhaseOffset(opts.cycle, subgroup.subgroupIndex, subgroup.subgroupCount);

    let anchorOpening: number | undefined;
    for (const empId of regular) {
      if (trailingSlots[empId] !== undefined) {
        anchorOpening = trailingSlots[empId];
        trailingAnchors += 1;
        break;
      }
    }

    if (anchorOpening === undefined) {
      for (const empId of regular) {
        if (opts.engineSlots[empId] !== undefined) {
          anchorOpening = opts.engineSlots[empId];
          break;
        }
      }
    }

    if (anchorOpening === undefined) {
      anchorOpening = cold[subgroup.subgroupIndex % cold.length] ?? cold[0];
    }

    regular.forEach((empId, i) => {
      const trail = trailingSlots[empId];
      const engine = opts.engineSlots[empId];
      if (trail !== undefined) {
        out[empId] = sgOffset > 0
          ? ((trail + sgOffset) % len + len) % len
          : trail;
        return;
      }
      if (engine !== undefined) {
        out[empId] = sgOffset > 0
          ? ((engine + sgOffset) % len + len) % len
          : engine;
        return;
      }
      out[empId] = ((anchorOpening! + sgOffset + i * stagger) % len + len) % len;
    });

    spreadCollidingOpeningSlots(out, regular, opts.cycle);

    floaters.forEach((empId, fi) => {
      const trail = trailingSlots[empId];
      if (trail !== undefined) {
        out[empId] = sgOffset > 0
          ? ((trail + sgOffset) % len + len) % len
          : trail;
      } else if (opts.engineSlots[empId] !== undefined) {
        const engine = opts.engineSlots[empId]!;
        out[empId] = sgOffset > 0
          ? ((engine + sgOffset) % len + len) % len
          : engine;
      } else {
        const anchor = regular[fi % regular.length];
        out[empId] = anchor !== undefined ? out[anchor]! : anchorOpening!;
      }
    });

    spreadCollidingOpeningSlots(out, subgroup.employeeIds, opts.cycle);
  }

  return {
    slots: out,
    trailingCount: trailingAnchors,
    historyCount: 0,
  };
}

export function generateCycleAssignments(opts: {
  ctx: EngineContext;
  positions: VplanPositionDef[];
  positionGroups: Record<string, string[]>;
  dateStrs: string[];
  openingSlotByEmp: Record<string, number>;
  cycle: string;
}): VplanAssignment[] {
  const template = getCycleTemplate(opts.cycle);
  const len = template.length;

  const empToPosition: Record<string, string> = {};
  for (const [posName, ids] of Object.entries(opts.positionGroups)) {
    ids.forEach((id) => { empToPosition[id] = posName; });
  }

  const assignments: VplanAssignment[] = [];

  for (const [empId, opening] of Object.entries(opts.openingSlotByEmp)) {
    const posName = empToPosition[empId];
    const pos = opts.positions.find((p) => p.positionName === posName);
    if (!pos || !is24hsPosition(pos)) continue;

    opts.dateStrs.forEach((dateStr, di) => {
      if (opts.ctx.absences[empId]?.has(dateStr)) return;
      const letter = dayLetter(dateStr);
      if (!isActiveDay(pos, letter)) return;

      const rawCode = template[(opening + di) % len];
      const hours = billableHoursForCode(rawCode, opts.cycle);
      const isFranco = rawCode === 'F';

      assignments.push({
        employeeId: empId,
        dateStr,
        code: rawCode,
        positionName: isFranco ? '' : posName,
        hours,
      });
    });
  }

  return assignments;
}

/** Conserva EN/RO/custom del motor y reemplaza filas 24hs del ciclo. */
export function mergeCycleWithEngineAssignments(
  engineAssignments: VplanAssignment[],
  cycleAssignments: VplanAssignment[],
  openingSlotByEmp: Record<string, number>,
): VplanAssignment[] {
  const cycleEmpIds = new Set(Object.keys(openingSlotByEmp));
  const cycleKeys = new Set(cycleAssignments.map((a) => `${a.employeeId}_${a.dateStr}`));
  const kept = engineAssignments.filter((a) => !cycleEmpIds.has(a.employeeId));
  const cycleMerged = cycleAssignments.filter((a) => cycleKeys.has(`${a.employeeId}_${a.dateStr}`));
  return [...kept, ...cycleMerged];
}

export function inferOpeningSlotsFromHistory4x2(
  assignments: Array<{ employeeId: string; dateStr: string; code: string }>,
  monthDateStrs: string[],
  targetMonthFirstDateStr: string,
): Record<string, number> {
  const template = getCycleTemplate('4+2');
  const len = template.length;
  const byEmp = new Map<string, Array<{ dateStr: string; code: string }>>();
  const anchor = new Date(`${targetMonthFirstDateStr}T12:00:00`).getTime();

  for (const a of assignments) {
    if (!monthDateStrs.includes(a.dateStr)) continue;
    const code = normalizeCodeForCycle(a.code, '4+2');
    if (!isCycleWorkCode(code, '4+2') && !isFrancoCycleCode(code)) continue;
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, []);
    byEmp.get(a.employeeId)!.push({ dateStr: a.dateStr, code });
  }

  const out: Record<string, number> = {};

  for (const [empId, rows] of byEmp) {
    if (rows.length < 3) continue;
    rows.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    let bestSlot: number | null = null;
    let bestScore = -Infinity;

    for (let opening = 0; opening < len; opening++) {
      let score = 0;
      for (const row of rows) {
        const offset = Math.round(
          (new Date(`${row.dateStr}T12:00:00`).getTime() - anchor) / 86_400_000,
        );
        const expected = template[(opening + offset + len * 200) % len];
        if (expected === row.code) score += 3;
        else if (isFrancoCycleCode(row.code) && expected === 'F') score += 2;
        else if (isCycleWorkCode(row.code, '4+2') && isCycleWorkCode(String(expected), '4+2')) score -= 2;
      }
      if (score > bestScore) {
        bestScore = score;
        bestSlot = opening;
      }
    }

    const minScore = Math.max(4, Math.floor(rows.length * 1.5));
    if (bestSlot !== null && bestScore >= minScore) {
      out[empId] = bestSlot;
    }
  }

  return out;
}

export function generate4x2Assignments(opts: {
  ctx: EngineContext;
  positions: VplanPositionDef[];
  positionGroups: Record<string, string[]>;
  dateStrs: string[];
  openingSlotByEmp: Record<string, number>;
}): { assignments: VplanAssignment[]; openingSlotByEmp: Record<string, number> } {
  const assignments = generateCycleAssignments({
    ctx: opts.ctx,
    positions: opts.positions,
    positionGroups: opts.positionGroups,
    dateStrs: opts.dateStrs,
    openingSlotByEmp: opts.openingSlotByEmp,
    cycle: '4+2',
  });
  return { assignments, openingSlotByEmp: opts.openingSlotByEmp };
}

export function is4x2CycleMode(cycle?: string): boolean {
  return is4x2Cycle(cycle);
}
