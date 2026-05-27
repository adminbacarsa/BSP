import { addDaysStr, forbiddenEveningToMorningWithoutBreak, forbiddenNightToNonNightWithoutBreak } from './restBetweenShifts';
import type { V2Assignment } from './autoScheduleEngineV2';

const FRANCO_SET = new Set(['F', 'FF', 'FP', 'FT']);

export function normBand(code: string): string {
    return String(code || '').toUpperCase();
}

export function bandMatchesExpected(expected: string | null | undefined, code: string): boolean {
    if (!expected) return false;
    const e = normBand(expected);
    const c = normBand(code);
    if (e === c) return true;
    if ((e === 'M' && c === 'D12') || (e === 'D12' && c === 'M')) return true;
    if ((e === 'N' && c === 'N12') || (e === 'N12' && c === 'N')) return true;
    return false;
}

/** Bloquea N→T/M y T→M consecutivos sin franco intermedio. */
export function assignmentBreaksBandTransition(
    assignments: V2Assignment[],
    empId: string,
    dateStr: string,
    nextCode: string,
): boolean {
    let d = addDaysStr(dateStr, -1);
    for (let i = 0; i < 21; i++) {
        const a = assignments.find(x => x.empId === empId && x.dateStr === d);
        if (!a) {
            d = addDaysStr(d, -1);
            continue;
        }
        const c = normBand(a.code);
        if (FRANCO_SET.has(c)) return false;
        if ((a.hours ?? 0) > 0) {
            return forbiddenNightToNonNightWithoutBreak(c, nextCode)
                || forbiddenEveningToMorningWithoutBreak(c, nextCode);
        }
        d = addDaysStr(d, -1);
    }
    return false;
}
