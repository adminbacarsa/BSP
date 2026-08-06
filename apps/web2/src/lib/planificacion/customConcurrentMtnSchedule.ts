/**
 * Puestos custom con M+T+N simultáneos (cupos, no rotación 24h).
 * Un guardia = una banda fija por día; el día necesita qty×M, qty×T, qty×N cubiertos.
 */

import type { V2EngineContext, V2PositionDef, V2ShiftDef } from './autoScheduleEngineV2';
import { effectiveShiftsForPositionDay, isCustomCoverPosition } from './autoScheduleEngineV2';
import { customCoverBandsForDay, customCoverDailyPax } from './customCoverCycle';
import { positionCoverageKind } from './positionCoverageKind';
import { empCanCoverPositionShift } from './positionAssignmentPolicy';
import { slaRotationExpectedShift } from './slaContractPlanning';
import { rankCoverersFromWisdom, type PlanningCoverageWisdom } from './planningCoverageWisdom';

const MTN_ORDER = ['M', 'T', 'N'] as const;

export function isCustomConcurrentMtnPosition(pos: V2PositionDef): boolean {
    return positionCoverageKind(pos) === 'custom_concurrent_mtn';
}

function bandSortOrder(code: string): number {
    const i = MTN_ORDER.indexOf(code as typeof MTN_ORDER[number]);
    return i >= 0 ? i : 99;
}

export function countCustomBandFilled(
    assignments: Array<{ dateStr: string; positionName: string; code: string; hours?: number }>,
    dateStr: string,
    positionName: string,
    code: string,
): number {
    return assignments.filter(
        (a) =>
            a.dateStr === dateStr
            && a.positionName === positionName
            && String(a.code || '').toUpperCase() === code
            && (a.hours ?? 0) > 0,
    ).length;
}

export interface FillCustomConcurrentMtnParams {
    ctx: V2EngineContext;
    pos: V2PositionDef;
    dateStr: string;
    dayLetter: string;
    inCurrent: boolean;
    groupIds: string[];
    titular?: string;
    assignments: Array<{ empId: string; dateStr: string; positionName: string; code: string; hours?: number }>;
    runtimeAssignedDays: (empId: string) => boolean;
    cycleWorkDay: (empId: string, dateStr: string) => boolean;
    isAbsent: (empId: string, dateStr: string) => boolean;
    sortByFewerHours: (empIds: string[], inCur: boolean) => string[];
    writeBand: (
        empId: string,
        shiftCode: string,
        sh: V2ShiftDef,
    ) => boolean;
}

/**
 * Cubre M, T y N el mismo día (qty por banda), respetando cobertura SLA y rotaciones.
 */
export function fillCustomConcurrentMtnBands(params: FillCustomConcurrentMtnParams): number {
    const {
        ctx,
        pos,
        dateStr,
        dayLetter,
        inCurrent,
        groupIds,
        titular,
        assignments,
        runtimeAssignedDays,
        cycleWorkDay,
        isAbsent,
        sortByFewerHours,
        writeBand,
    } = params;

    if (!isCustomCoverPosition(pos) || !isCustomConcurrentMtnPosition(pos)) return 0;

    const dayBands = customCoverBandsForDay(pos, dayLetter, ctx.autoCycles, dateStr);
    const qty = customCoverDailyPax(pos);
    const wisdom = ctx.coverageWisdom ?? null;

    const bandsSorted = [...dayBands].sort(
        (a, b) =>
            bandSortOrder(String(a.code || '').toUpperCase())
            - bandSortOrder(String(b.code || '').toUpperCase()),
    );
    const perBandNeed = bandsSorted.length > 0 ? Math.max(1, Math.ceil(qty / bandsSorted.length)) : qty;

    let totalFilled = 0;

    for (const sh of bandsSorted) {
        const bandCode = String(sh.code || '').toUpperCase();
        const need = perBandNeed;
        let have = countCustomBandFilled(assignments, dateStr, pos.positionName, bandCode);
        if (have >= need) continue;

        const baseCandidates = groupIds.filter(
            (empId) =>
                !runtimeAssignedDays(empId)
                && cycleWorkDay(empId, dateStr)
                && !isAbsent(empId, dateStr)
                && empCanCoverPositionShift(ctx, empId, pos.positionName, bandCode),
        );

        const slaMatch: string[] = [];
        const defaultMatch: string[] = [];
        const rest: string[] = [];
        for (const empId of baseCandidates) {
            const sla = slaRotationExpectedShift(ctx, empId, dateStr, pos.positionName);
            if (sla === bandCode) {
                slaMatch.push(empId);
            } else if (sla && sla !== bandCode) {
                continue;
            } else if (String(ctx.defaultShiftByEmp?.[empId] || '').toUpperCase() === bandCode) {
                defaultMatch.push(empId);
            } else {
                rest.push(empId);
            }
        }

        let ordered = [...slaMatch, ...defaultMatch, ...rest];
        if (titular && ordered.includes(titular) && bandCode === String(ctx.defaultShiftByEmp?.[titular] || '').toUpperCase()) {
            ordered = [titular, ...ordered.filter((id) => id !== titular)];
        }
        ordered = sortByFewerHours(ordered, inCurrent);

        if (wisdom && ordered.length > 1) {
            const profiles = rankCoverersFromWisdom(wisdom, bandCode, { absentCode: 'E', limit: ordered.length });
            const rankedIds = profiles.map((p) => p.empId).filter((id) => ordered.includes(id));
            if (rankedIds.length > 0) {
                const rankSet = new Set(rankedIds);
                ordered = [...rankedIds, ...ordered.filter((id) => !rankSet.has(id))];
            }
        }

        for (const empId of ordered) {
            if (have >= need) break;
            if (writeBand(empId, bandCode, sh)) {
                have++;
                totalFilled++;
            }
        }
    }

    return totalFilled;
}
