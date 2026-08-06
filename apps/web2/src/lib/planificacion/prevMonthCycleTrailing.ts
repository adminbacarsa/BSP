/**
 * Racha de ciclo al cierre del mes anterior → fase correcta del día 1.
 * Misma lógica que Automatizar en planificacion/index.tsx (lookback ~10 días).
 */

import type { PlanningShiftCell } from './planningCoverageWisdom';

const FRANCO_CODES_SET = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);

export function defaultCalendarDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function buildShiftTrailByEmpFromCells(
    cells: PlanningShiftCell[],
    objectiveId?: string,
): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const cell of cells) {
        if (objectiveId && cell.objectiveId !== objectiveId) continue;
        const code = String(cell.code || '').toUpperCase().trim();
        if (!code) continue;
        if (!out[cell.employeeId]) out[cell.employeeId] = {};
        out[cell.employeeId][cell.dateStr] = code;
    }
    return out;
}

export interface PrevMonthCycleTrailingResult {
    prevMonthTrailingWorkDays: Record<string, number>;
    prevMonthTrailingRestDays: Record<string, number>;
    prevMonthLastShiftByEmp: Record<string, string>;
    prevMonthLastWorkBandBeforeRest: Record<string, string>;
}

export function computePrevMonthCycleTrailing(params: {
    employeeIds: string[];
    prevTrailByEmp: Record<string, Record<string, string>>;
    prevMonthEndDate: Date;
    getDateKey?: (d: Date) => string;
}): PrevMonthCycleTrailingResult {
    const getDateKey = params.getDateKey ?? defaultCalendarDateKey;
    const prevMonthTrailingWorkDays: Record<string, number> = {};
    const prevMonthTrailingRestDays: Record<string, number> = {};
    const prevMonthLastShiftByEmp: Record<string, string> = {};
    const prevMonthLastWorkBandBeforeRest: Record<string, string> = {};

    const lastDayStr = getDateKey(params.prevMonthEndDate);

    for (const empId of params.employeeIds) {
        const empShifts = prevTrailByEmp[empId] || {};
        const lastCode = empShifts[lastDayStr];
        if (!lastCode) continue;

        if (lastCode === 'RET') {
            prevMonthLastShiftByEmp[empId] = 'RET';
            let workCount = 1;
            let foundBand: string | null = null;
            let consGap = 0;
            for (let d = params.prevMonthEndDate.getDate() - 1; d >= 1; d--) {
                const ds = getDateKey(
                    new Date(params.prevMonthEndDate.getFullYear(), params.prevMonthEndDate.getMonth(), d),
                );
                const c = empShifts[ds];
                if (!c) {
                    consGap++;
                    if (consGap > 1) break;
                    workCount++;
                    continue;
                }
                consGap = 0;
                if (FRANCO_CODES_SET.has(c)) break;
                if (c !== 'RET' && !foundBand) foundBand = c;
                workCount++;
            }
            prevMonthTrailingWorkDays[empId] = workCount;
            prevMonthTrailingRestDays[empId] = 0;
            if (foundBand) prevMonthLastWorkBandBeforeRest[empId] = foundBand;
            continue;
        }

        prevMonthLastShiftByEmp[empId] = lastCode;
        if (FRANCO_CODES_SET.has(lastCode)) {
            for (let d = params.prevMonthEndDate.getDate(); d >= 1; d--) {
                const ds = getDateKey(
                    new Date(params.prevMonthEndDate.getFullYear(), params.prevMonthEndDate.getMonth(), d),
                );
                const c = empShifts[ds];
                if (!c) break;
                if (!FRANCO_CODES_SET.has(c)) {
                    prevMonthLastWorkBandBeforeRest[empId] = c;
                    break;
                }
            }
        }

        const isFrancoLast = FRANCO_CODES_SET.has(lastCode);
        let count = 0;
        let consecutiveMissing = 0;
        for (let d = params.prevMonthEndDate.getDate(); d >= 1; d--) {
            const ds = getDateKey(
                new Date(params.prevMonthEndDate.getFullYear(), params.prevMonthEndDate.getMonth(), d),
            );
            const c = empShifts[ds];
            if (!c) {
                consecutiveMissing++;
                if (consecutiveMissing > 1) break;
                count++;
                continue;
            }
            consecutiveMissing = 0;
            const isFranco = FRANCO_CODES_SET.has(c);
            if (isFrancoLast && isFranco) count++;
            else if (!isFrancoLast && !isFranco) count++;
            else break;
        }
        if (isFrancoLast) prevMonthTrailingRestDays[empId] = count;
        else prevMonthTrailingWorkDays[empId] = count;
    }

    return {
        prevMonthTrailingWorkDays,
        prevMonthTrailingRestDays,
        prevMonthLastShiftByEmp,
        prevMonthLastWorkBandBeforeRest,
    };
}
