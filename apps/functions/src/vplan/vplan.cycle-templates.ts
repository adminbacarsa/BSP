/**
 * Plantillas de ciclo CCT para VPLAN.
 * 6+2 → M/T/N (24 días) | 4+2 → D12/N12 (12 días)
 */

export type VplanCycleKey = '6+2' | '4+2' | '5+1' | '6+1';

export const CYCLE_24_MTN: readonly string[] = [
  ...Array(6).fill('M'),
  ...Array(2).fill('F'),
  ...Array(6).fill('T'),
  ...Array(2).fill('F'),
  ...Array(6).fill('N'),
  ...Array(2).fill('F'),
];

/** 4×D12 + 2F + 4×N12 + 2F = 12 días (4+2 en bandas 12h). */
export const CYCLE_12_DN: readonly string[] = [
  ...Array(4).fill('D12'),
  ...Array(2).fill('F'),
  ...Array(4).fill('N12'),
  ...Array(2).fill('F'),
];

export const COLD_START_24 = [4, 10, 16, 22] as const;
export const COLD_START_12 = [2, 6, 10] as const;

const WORK_8 = new Set(['M', 'T', 'N']);
const WORK_12 = new Set(['D12', 'N12']);
const FRANCO = new Set(['F', 'FF', 'FP', 'FT']);

export function normalizeCycleKey(cycle?: string): VplanCycleKey {
  if (cycle === '4+2' || cycle === '5+1' || cycle === '6+1') return cycle;
  return '6+2';
}

export function is4x2Cycle(cycle?: string): boolean {
  return normalizeCycleKey(cycle) === '4+2';
}

export function getCycleTemplate(cycle?: string): readonly string[] {
  return is4x2Cycle(cycle) ? CYCLE_12_DN : CYCLE_24_MTN;
}

export function cycleLength(cycle?: string): number {
  return getCycleTemplate(cycle).length;
}

export function coldStartOpenings(cycle?: string): readonly number[] {
  return is4x2Cycle(cycle) ? COLD_START_12 : COLD_START_24;
}

export function subgroupSize(cycle?: string): number {
  return is4x2Cycle(cycle) ? 3 : 4;
}

/** Normaliza códigos 8h → 12h al migrar historial o trailing hacia 4+2. */
export function normalizeCodeForCycle(code: string, cycle?: string): string {
  const c = code.toUpperCase();
  if (!is4x2Cycle(cycle)) return c;
  if (c === 'M' || c === 'T' || c === 'D12') return 'D12';
  if (c === 'N' || c === 'N12') return 'N12';
  if (FRANCO.has(c)) return 'F';
  return c;
}

export function isCycleWorkCode(code: string, cycle?: string): boolean {
  const c = code.toUpperCase();
  if (FRANCO.has(c)) return false;
  if (is4x2Cycle(cycle)) return WORK_12.has(c);
  return WORK_8.has(c) || WORK_12.has(c);
}

export function isFrancoCycleCode(code: string): boolean {
  return FRANCO.has(code.toUpperCase());
}

export function bandZoneForSlot(slot: number, cycle?: string): string {
  const len = cycleLength(cycle);
  const s = ((slot % len) + len) % len;
  return getCycleTemplate(cycle)[s];
}

export function maxWorkStreak(cycle?: string): number {
  const key = normalizeCycleKey(cycle);
  if (key === '4+2') return 4;
  if (key === '5+1') return 5;
  if (key === '6+1') return 6;
  return 6;
}

export function billableHoursForCode(code: string, cycle?: string): number {
  const c = code.toUpperCase();
  if (FRANCO.has(c)) return 0;
  if (c === 'D12' || c === 'N12') return 12;
  if (is4x2Cycle(cycle) && WORK_8.has(c)) return 12;
  return 8;
}

const FRANCO_SET = FRANCO;
const WORK_8_SET = WORK_8;

/** Infiere opening slot desde último código + racha (prioridad sobre motor/historial). */
export function inferCycleSlotFromTrailing(
  lastCode: string | undefined,
  trailingWork: number | undefined,
  trailingRest: number | undefined,
  lastWorkBand?: string,
  cycle = '6+2',
): number | null {
  if (!lastCode) return null;
  const template = getCycleTemplate(cycle);
  const len = template.length;
  let code = lastCode.toUpperCase();
  if (is4x2Cycle(cycle)) code = normalizeCodeForCycle(code, cycle);

  const workBlock = is4x2Cycle(cycle) ? 4 : 6;
  const candidates: number[] = [];

  if (code === 'RET' || code === 'R') {
    const band = (lastWorkBand || '').toUpperCase();
    const effective = is4x2Cycle(cycle) ? normalizeCodeForCycle(band, cycle) : band;
    if (!isCycleWorkCode(effective, cycle)) return null;
    code = effective;
  }

  for (let day1 = 0; day1 < len; day1++) {
    const prevDay = (day1 - 1 + len) % len;
    if (template[prevDay] !== code) continue;

    if (isCycleWorkCode(code, cycle)) {
      const need = Math.max(1, trailingWork ?? 1);
      let ok = 0;
      for (let b = 0; b < need; b++) {
        if (template[(prevDay - b + len) % len] !== code) break;
        ok += 1;
      }
      if (ok >= need) candidates.push(day1);
    } else if (FRANCO_SET.has(code)) {
      const need = Math.max(1, trailingRest ?? 1);
      let ok = 0;
      for (let b = 0; b < need; b++) {
        if (template[(prevDay - b + len) % len] !== 'F') break;
        ok += 1;
      }
      if (ok < need) continue;
      if (need === 1 && template[day1] !== 'F') continue;
      if (need >= 2 && !isCycleWorkCode(String(template[day1]), cycle)) continue;
      candidates.push(day1);
    }
  }

  if (candidates.length === 0) return null;

  if (isCycleWorkCode(code, cycle)) {
    const streak = trailingWork ?? 1;
    const continueSameBand = streak < workBlock;
    if (continueSameBand) {
      const same = candidates.find((d) => template[d] === code);
      if (same !== undefined) return same;
    } else {
      const franco = candidates.find((d) => template[d] === 'F');
      if (franco !== undefined) return franco;
    }
  }

  return candidates[0];
}

export function inferTrailingOpeningSlots(
  prevPlanningState: {
    lastShiftByEmp?: Record<string, string>;
    trailingWorkDays?: Record<string, number>;
    trailingRestDays?: Record<string, number>;
    lastWorkBandBeforeRest?: Record<string, string>;
  },
  cycle = '6+2',
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const empId of Object.keys(prevPlanningState.lastShiftByEmp || {})) {
    const slot = inferCycleSlotFromTrailing(
      prevPlanningState.lastShiftByEmp?.[empId],
      prevPlanningState.trailingWorkDays?.[empId],
      prevPlanningState.trailingRestDays?.[empId],
      prevPlanningState.lastWorkBandBeforeRest?.[empId],
      cycle,
    );
    if (slot !== null) out[empId] = slot;
  }
  return out;
}
