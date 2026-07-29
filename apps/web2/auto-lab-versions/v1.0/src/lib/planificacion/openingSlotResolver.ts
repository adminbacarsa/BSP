/**
 * Deriva openingSlotByEmp para post-proceso cuando el motor V4 no lo expone
 * (p. ej. Auto Lab con excedente vs plantilla → strictSixTwo false).
 */

import type { V2Assignment, V2GenerateStats, V2PositionDef, V2EngineContext } from './autoScheduleEngineV2';
import { CYCLE_24_MTN } from './rotativeMtnCycle';
import { employeeAssignedToCustomCover } from './customCoverCycle';
import { resolveMonthStartGlobalDayIndex } from './surplusRetCycle';

const WORK_BANDS = new Set(['M', 'T', 'N']);
const ZONE_BASE: Record<string, number> = { M: 0, T: 8, N: 16 };

function inferOpeningFromAssignment(
    empId: string,
    assignments: V2Assignment[],
    daysInMonth: Date[],
    getDateKey: (d: Date) => string,
    primaryBand?: string,
    monthStartGlobalDayIndex?: number,
): number | undefined {
    const monthStart = monthStartGlobalDayIndex ?? (() => {
        const d0 = daysInMonth[0];
        if (!d0) return 0;
        const ANCHOR = new Date(2020, 0, 1);
        return Math.round((d0.getTime() - ANCHOR.getTime()) / 86_400_000);
    })();

    for (let di = 0; di < daysInMonth.length; di++) {
        const dateStr = getDateKey(daysInMonth[di]);
        const cell = assignments.find((a) => a.empId === empId && a.dateStr === dateStr);
        const code = String(cell?.code || '').toUpperCase();
        if (!WORK_BANDS.has(code)) continue;

        const absDay = monthStart + di;
        const candidates: number[] = [];
        for (let opening = 0; opening < 24; opening++) {
            if (String(CYCLE_24_MTN[(opening + absDay) % 24]).toUpperCase() === code) {
                candidates.push(opening);
            }
        }
        if (candidates.length === 0) continue;
        if (candidates.length === 1) return candidates[0];

        const zoneBase = ZONE_BASE[String(primaryBand || '').toUpperCase()];
        if (zoneBase !== undefined) {
            const inZone = candidates.find((o) => o >= zoneBase && o <= zoneBase + 5);
            if (inZone !== undefined) return inZone;
        }
        return candidates[0];
    }
    return undefined;
}

/** Usa stats.openingSlotByEmp del floater o lo infiere desde asignaciones / banda primaria. */
export function resolveOpeningSlotByEmpForPostProcess(params: {
    stats: V2GenerateStats;
    assignments: V2Assignment[];
    daysInMonth: Date[];
    getDateKey: (d: Date) => string;
    employeeIds?: string[];
    positions?: V2PositionDef[];
    monthStartGlobalDayIndex?: number;
}): Record<string, number> | undefined {
    const { stats, assignments, daysInMonth, getDateKey, positions = [] } = params;
    const monthStart = params.monthStartGlobalDayIndex ?? resolveMonthStartGlobalDayIndex({
        daysInMonth,
        monthStartGlobalDayIndex: params.monthStartGlobalDayIndex,
    } as Pick<V2EngineContext, 'daysInMonth' | 'monthStartGlobalDayIndex'>);
    if (stats.openingSlotByEmp && Object.keys(stats.openingSlotByEmp).length > 0) {
        return { ...stats.openingSlotByEmp };
    }

    const primary = stats.primaryShiftByEmp ?? {};
    const empIds = new Set<string>(params.employeeIds ?? []);
    for (const ids of Object.values(stats.positionGroups ?? {})) {
        for (const id of ids) empIds.add(id);
    }
    for (const id of stats.idleEmployeeIds ?? []) empIds.add(id);

    const out: Record<string, number> = {};
    for (const empId of empIds) {
        if (employeeAssignedToCustomCover(empId, positions, stats.positionGroups)) continue;

        const inferred = inferOpeningFromAssignment(
            empId,
            assignments,
            daysInMonth,
            getDateKey,
            primary[empId] ?? undefined,
            monthStart,
        );
        if (inferred !== undefined) {
            out[empId] = inferred;
            continue;
        }
        const pBand = String(primary[empId] || '').toUpperCase();
        if (ZONE_BASE[pBand] !== undefined) {
            out[empId] = ZONE_BASE[pBand];
        }
    }

    return Object.keys(out).length > 0 ? out : undefined;
}
