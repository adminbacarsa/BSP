/**
 * Arranque de ciclo pool custom (5+1…): continuidad mes anterior o anclas desde cycleStartDate.
 */

import type { ServiceRotation } from '@/services/slaService';

const POOL_CYCLE_MAP: Record<string, [number, number]> = {
    '4+2': [4, 2],
    '5+1': [5, 1],
    '6+1': [6, 1],
    '6+2': [6, 2],
};

export function poolCycleDimensions(cycleKey: string): { cL: number; cF: number; cycleLen: number } {
    const [cL, cF] = POOL_CYCLE_MAP[cycleKey] ?? POOL_CYCLE_MAP['5+1'];
    return { cL, cF, cycleLen: cL + cF };
}

export function poolCycleOffsetForEmployee(
    cycleKey: string,
    empIndex: number,
    trailingWork?: number,
    trailingRest?: number,
    seed = 0,
): number {
    const { cF, cycleLen } = poolCycleDimensions(cycleKey);
    if (trailingWork !== undefined && trailingWork > 0) {
        return trailingWork % cycleLen;
    }
    if (trailingRest !== undefined && trailingRest > 0 && trailingRest < cF) {
        const { cL } = poolCycleDimensions(cycleKey);
        return (cL + trailingRest) % cycleLen;
    }
    return ((empIndex >= 0 ? empIndex : 0) + seed) % cycleLen;
}

export function calendarDaysBetween(fromDateStr: string, toDateStr: string): number {
    const fromMs = new Date(`${fromDateStr}T12:00:00`).getTime();
    const toMs = new Date(`${toDateStr}T12:00:00`).getTime();
    return Math.round((toMs - fromMs) / 86_400_000);
}

export function addCalendarDays(dateStr: string, delta: number): string {
    const d = new Date(`${dateStr}T12:00:00`);
    d.setDate(d.getDate() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function resolvePoolCycleStartDate(
    rotations?: ServiceRotation[],
    serviceStartDate?: string,
    monthFirstDay?: string,
): string | undefined {
    for (const rot of rotations ?? []) {
        if (rot.cycleMode === 'cycle_rotation' && rot.cycleStartDate) {
            return String(rot.cycleStartDate).slice(0, 10);
        }
    }
    if (serviceStartDate) return String(serviceStartDate).slice(0, 10);
    if (monthFirstDay) return monthFirstDay.slice(0, 10);
    return undefined;
}

export function extractPoolCycleAnchorsFromRotations(
    rotations?: ServiceRotation[],
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rot of rotations ?? []) {
        if (rot.cycleMode !== 'cycle_rotation') continue;
        for (const period of rot.periods ?? []) {
            for (const entry of period.entries ?? []) {
                const empId = String(entry.employeeId || '').trim();
                const anchor = entry.cycleAnchorDate ? String(entry.cycleAnchorDate).slice(0, 10) : '';
                if (empId && anchor) out[empId] = anchor;
            }
        }
    }
    return out;
}

export function employeeHasPoolCycleTrailing(
    empId: string,
    cF: number,
    prevMonthTrailingWorkDays?: Record<string, number>,
    prevMonthTrailingRestDays?: Record<string, number>,
): boolean {
    const tw = prevMonthTrailingWorkDays?.[empId];
    const tr = prevMonthTrailingRestDays?.[empId];
    if (tw !== undefined && tw > 0) return true;
    if (tr !== undefined && tr > 0 && tr < cF) return true;
    return false;
}

/** Ancla día 0 del ciclo por legajo (sin trailing): escalonado desde cycleStartDate. */
export function buildGreenfieldPoolCycleAnchors(
    employeeIds: string[],
    cycleStartDate: string,
    cycleKey: string,
): Record<string, string> {
    const { cycleLen } = poolCycleDimensions(cycleKey);
    const out: Record<string, string> = {};
    employeeIds.forEach((empId, i) => {
        const stagger = i % cycleLen;
        out[empId] = addCalendarDays(cycleStartDate, -stagger);
    });
    return out;
}

export interface ResolvePoolCycleAnchorParams {
    employeeIds: string[];
    cycleKey: string;
    poolCycleStartDate?: string;
    cycleAnchorByEmp?: Record<string, string>;
    prevMonthTrailingWorkDays?: Record<string, number>;
    prevMonthTrailingRestDays?: Record<string, number>;
}

/**
 * Ancla por legajo solo si no hay trailing (continuidad julio manda).
 */
export function resolvePoolCycleAnchorByEmp(params: ResolvePoolCycleAnchorParams): Record<string, string> {
    const { cF } = poolCycleDimensions(params.cycleKey);
    const out: Record<string, string> = {};
    const slaAnchors = params.cycleAnchorByEmp ?? {};

    let greenfield: Record<string, string> | null = null;
    if (params.poolCycleStartDate) {
        greenfield = buildGreenfieldPoolCycleAnchors(
            params.employeeIds,
            params.poolCycleStartDate,
            params.cycleKey,
        );
    }

    for (const empId of params.employeeIds) {
        if (employeeHasPoolCycleTrailing(
            empId,
            cF,
            params.prevMonthTrailingWorkDays,
            params.prevMonthTrailingRestDays,
        )) {
            continue;
        }
        if (slaAnchors[empId]) {
            out[empId] = slaAnchors[empId];
            continue;
        }
        if (greenfield?.[empId]) {
            out[empId] = greenfield[empId];
        }
    }
    return out;
}

export function isPoolCycleWorkDayFromAnchor(
    dateStr: string,
    anchorDateStr: string,
    cycleKey: string,
): boolean {
    const { cL, cycleLen } = poolCycleDimensions(cycleKey);
    const dSince = calendarDaysBetween(anchorDateStr, dateStr);
    const pos = ((dSince % cycleLen) + cycleLen) % cycleLen;
    return pos < cL;
}

export function isPoolCycleWorkDay(params: {
    dateStr: string;
    cycleKey: string;
    absDay: number;
    empIndex: number;
    empId: string;
    anchorDateStr?: string;
    offset?: number;
    prevMonthTrailingWorkDays?: Record<string, number>;
    prevMonthTrailingRestDays?: Record<string, number>;
    distributedOffsetSeed?: number;
}): boolean {
    const { cL, cF, cycleLen } = poolCycleDimensions(params.cycleKey);
    if (params.anchorDateStr) {
        return isPoolCycleWorkDayFromAnchor(params.dateStr, params.anchorDateStr, params.cycleKey);
    }
    const offset = params.offset ?? poolCycleOffsetForEmployee(
        params.cycleKey,
        params.empIndex,
        params.prevMonthTrailingWorkDays?.[params.empId],
        params.prevMonthTrailingRestDays?.[params.empId],
        params.distributedOffsetSeed ?? 0,
    );
    const slot = ((params.absDay + offset) % cycleLen + cycleLen) % cycleLen;
    return slot < cL;
}

export interface PoolFrancoBalanceReport {
    ok: boolean;
    expectedFrancosPerDay: number;
    daysOff: Record<string, number>;
    badDays: string[];
}

/** Valida 2 F/día (o dotación − cupos) en días operativos del pool. */
export function validatePoolFrancoBalance(
    cycleWorkDays: Record<string, Set<string>>,
    employeeIds: string[],
    daysInMonth: string[],
    expectedFrancosPerDay: number,
): PoolFrancoBalanceReport {
    const daysOff: Record<string, number> = {};
    const badDays: string[] = [];
    for (const dateStr of daysInMonth) {
        let working = 0;
        for (const empId of employeeIds) {
            if (cycleWorkDays[empId]?.has(dateStr)) working++;
        }
        const off = employeeIds.length - working;
        daysOff[dateStr] = off;
        if (off !== expectedFrancosPerDay) badDays.push(dateStr);
    }
    return {
        ok: badDays.length === 0,
        expectedFrancosPerDay,
        daysOff,
        badDays,
    };
}

export function francosPerOperationalDay(peopleCount: number, slotsPerDay: number): number {
    return Math.max(0, peopleCount - slotsPerDay);
}

export function buildPoolCycleOffsetByEmp(params: {
    employeeIds: string[];
    cycleKey: string;
    prevMonthTrailingWorkDays?: Record<string, number>;
    prevMonthTrailingRestDays?: Record<string, number>;
    distributedOffsetSeed?: number;
}): Record<string, number> {
    const out: Record<string, number> = {};
    const seed = params.distributedOffsetSeed ?? 0;
    params.employeeIds.forEach((empId, empIdx) => {
        out[empId] = poolCycleOffsetForEmployee(
            params.cycleKey,
            empIdx,
            params.prevMonthTrailingWorkDays?.[empId],
            params.prevMonthTrailingRestDays?.[empId],
            seed,
        );
    });
    return out;
}

export interface BuildObjectivePoolCycleWorkDaysParams {
    employeeIds: string[];
    daysInMonth: Date[];
    cycleKey: string;
    monthStartGlobalDayIndex: number;
    getDateKey: (d: Date) => string;
    getDayLetter: (dateStr: string) => string;
    isOperationalDay?: (dateStr: string, dayLetter: string) => boolean;
    offsetByEmp?: Record<string, number>;
    prevMonthTrailingWorkDays?: Record<string, number>;
    prevMonthTrailingRestDays?: Record<string, number>;
    distributedOffsetSeed?: number;
    poolCycleStartDate?: string;
    cycleAnchorByEmp?: Record<string, string>;
}

export function buildObjectivePoolCycleWorkDays(
    params: BuildObjectivePoolCycleWorkDaysParams,
): Record<string, Set<string>> {
    const { cF } = poolCycleDimensions(params.cycleKey);
    const offsetByEmp = params.offsetByEmp ?? buildPoolCycleOffsetByEmp({
        employeeIds: params.employeeIds,
        cycleKey: params.cycleKey,
        prevMonthTrailingWorkDays: params.prevMonthTrailingWorkDays,
        prevMonthTrailingRestDays: params.prevMonthTrailingRestDays,
        distributedOffsetSeed: params.distributedOffsetSeed,
    });
    const anchorByEmp = resolvePoolCycleAnchorByEmp({
        employeeIds: params.employeeIds,
        cycleKey: params.cycleKey,
        poolCycleStartDate: params.poolCycleStartDate,
        cycleAnchorByEmp: params.cycleAnchorByEmp,
        prevMonthTrailingWorkDays: params.prevMonthTrailingWorkDays,
        prevMonthTrailingRestDays: params.prevMonthTrailingRestDays,
    });
    const out: Record<string, Set<string>> = {};
    for (const empId of params.employeeIds) {
        out[empId] = new Set<string>();
    }
    params.daysInMonth.forEach((day, di) => {
        const dateStr = params.getDateKey(day);
        const dayLetter = params.getDayLetter(dateStr);
        if (params.isOperationalDay && !params.isOperationalDay(dateStr, dayLetter)) {
            return;
        }
        const absDay = params.monthStartGlobalDayIndex + di;
        params.employeeIds.forEach((empId, empIdx) => {
            const useTrailing = employeeHasPoolCycleTrailing(
                empId,
                cF,
                params.prevMonthTrailingWorkDays,
                params.prevMonthTrailingRestDays,
            );
            const anchor = !useTrailing ? anchorByEmp[empId] : undefined;
            const work = isPoolCycleWorkDay({
                dateStr,
                cycleKey: params.cycleKey,
                absDay,
                empIndex: empIdx,
                empId,
                anchorDateStr: anchor,
                offset: useTrailing ? offsetByEmp[empId] : undefined,
                prevMonthTrailingWorkDays: params.prevMonthTrailingWorkDays,
                prevMonthTrailingRestDays: params.prevMonthTrailingRestDays,
                distributedOffsetSeed: params.distributedOffsetSeed,
            });
            if (work) {
                out[empId].add(dateStr);
            }
        });
    });
    return out;
}
