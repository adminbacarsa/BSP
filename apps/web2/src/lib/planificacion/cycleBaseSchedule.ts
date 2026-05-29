/**
 * Etapa 3 — asignación 100% derivada del ciclo (sin demand-driven SLA).
 * Solo péndulo M→T→N, francos del ciclo y descanso CCT.
 */

import {
    effectiveShiftsForPositionDay,
    positionIsActiveOn,
    type V2Assignment,
    type V2EngineContext,
    type V2PositionDef,
} from './autoScheduleEngineV2';
import { isModo12Day } from './objectiveCoverageDemand';
import { normBand } from './rotativeBandGuard';

type RuntimeCell = {
    assignedDays: Set<string>;
};

export type CycleBaseFillParams = {
    ctx: V2EngineContext;
    assignments: V2Assignment[];
    runtime: Record<string, RuntimeCell>;
    cycleWorkDays: Record<string, Set<string>>;
    empAssignedTo: Record<string, string | null>;
    cutoffDay: number;
    isCustomCoverPosition: (pos: V2PositionDef) => boolean;
    expectedShiftForDay: (empId: string, dateStr: string, posName: string) => string | null;
    tryAssignBandSlot: (
        empId: string,
        pos: V2PositionDef,
        dateStr: string,
        sCode: string,
        sh: { code?: string; name?: string; hours?: number; startTime?: string; endTime?: string },
        inCurrentCycle: boolean,
    ) => boolean;
};

function pushFranco(
    assignments: V2Assignment[],
    runtime: Record<string, RuntimeCell>,
    empId: string,
    dateStr: string,
): void {
    assignments.push({
        empId,
        dateStr,
        positionName: '',
        code: 'F',
        name: 'Franco',
        hours: 0,
        startTime: '00:00',
        isFranco: true,
    });
    runtime[empId]?.assignedDays.add(dateStr);
}

/**
 * Por empleado × día: F en descanso de ciclo; turno de péndulo en día laborable.
 * No rellena huecos SLA cross-puesto ni convierte F→turno.
 */
export function fillCycleBaseRotativeAssignments(params: CycleBaseFillParams): void {
    const {
        ctx, assignments, runtime, cycleWorkDays, empAssignedTo,
        cutoffDay, isCustomCoverPosition, expectedShiftForDay, tryAssignBandSlot,
    } = params;

    for (const emp of ctx.employees) {
        const st = runtime[emp.id];
        if (!st) continue;

        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            if (st.assignedDays.has(dateStr)) continue;
            if (ctx.absences[emp.id]?.has(dateStr)) continue;

            const dayLetter = ctx.getDayLetter(dateStr);
            const inCurrent = day.getDate() <= cutoffDay;

            if (!cycleWorkDays[emp.id]?.has(dateStr)) {
                pushFranco(assignments, runtime, emp.id, dateStr);
                continue;
            }

            const posName = empAssignedTo[emp.id];
            if (!posName) continue;
            const pos = ctx.positions.find(p => p.positionName === posName);
            if (!pos || isCustomCoverPosition(pos)) continue;
            if (!positionIsActiveOn(pos, dayLetter)) continue;

            const expected = expectedShiftForDay(emp.id, dateStr, posName);
            if (!expected) {
                pushFranco(assignments, runtime, emp.id, dateStr);
                continue;
            }

            const dayShifts = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);
            if (isModo12Day(dateStr, ctx)) {
                const bc = normBand(expected);
                const slotCode = bc === 'N' || bc === 'N12' ? 'N12' : bc === 'T' ? null : 'D12';
                if (slotCode) {
                    const sh = dayShifts.find(s => String(s.code || '').toUpperCase() === slotCode);
                    if (sh && tryAssignBandSlot(emp.id, pos, dateStr, slotCode, sh, inCurrent)) {
                        continue;
                    }
                }
            } else {
                const sh = dayShifts.find(s => String(s.code || '').toUpperCase() === expected);
                if (sh && tryAssignBandSlot(emp.id, pos, dateStr, String(sh.code || '').toUpperCase(), sh, inCurrent)) {
                    continue;
                }
            }
        }
    }
}
