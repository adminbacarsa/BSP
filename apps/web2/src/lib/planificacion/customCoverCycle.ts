import type { V2PositionDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition, positionIsActiveOn } from './autoScheduleEngineV2';

const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);

/** Puesto opera los 7 días de la semana según activeDays del SLA. */
export function customPositionOperatesAllWeek(pos: V2PositionDef): boolean {
    return ['L', 'M', 'X', 'J', 'V', 'S', 'D'].every((l) => positionIsActiveOn(pos, l));
}

/**
 * Ciclo semanal de trabajo/descanso para custom (MA, ME, RO…).
 * No es 6+2 M/T/N; es jornada fija con francos escalonados (~56–60 h/semana).
 */
export function customCoverWeeklyWorkRest(pos: V2PositionDef): { workDays: number; restDays: number; cycleLen: number } {
    const working = (pos.shifts || []).filter(
        (s) => !FRANCO_CODES.has(String(s.code ?? '').toUpperCase()),
    );
    const hrs = Math.max(1, Number(working[0]?.hours) || 8);
    const workDays = hrs >= 11 ? 5 : 6;
    const restDays = Math.max(1, 7 - workDays);
    return { workDays, restDays, cycleLen: workDays + restDays };
}

export interface BuildCustomCycleWorkDaysParams {
    empId: string;
    pos: V2PositionDef;
    daysInMonth: Date[];
    groupMemberIds: string[];
    monthStartGlobalDayIndex: number;
    getDateKey: (d: Date) => string;
    getDayLetter: (dateStr: string) => string;
}

/**
 * Días laborables del mes para un titular custom.
 * - L–V u horario acotado: todos los días operativos del SLA (fuera = F natural).
 * - 7 días/semana: patrón 6+1 o 5+2 escalonado por índice en el grupo del puesto.
 */
export function buildCustomCycleWorkDays(params: BuildCustomCycleWorkDaysParams): Set<string> {
    const set = new Set<string>();
    const {
        empId,
        pos,
        daysInMonth,
        groupMemberIds,
        monthStartGlobalDayIndex,
        getDateKey,
        getDayLetter,
    } = params;

    if (!isCustomCoverPosition(pos)) return set;

    if (!customPositionOperatesAllWeek(pos)) {
        daysInMonth.forEach((day) => {
            const dateStr = getDateKey(day);
            const dayLetter = getDayLetter(dateStr);
            if (positionIsActiveOn(pos, dayLetter)) set.add(dateStr);
        });
        return set;
    }

    const { workDays, cycleLen } = customCoverWeeklyWorkRest(pos);
    const idxInGroup = Math.max(0, groupMemberIds.indexOf(empId));
    const offset = idxInGroup >= 0 ? idxInGroup % cycleLen : 0;

    daysInMonth.forEach((day, di) => {
        const dateStr = getDateKey(day);
        const dayLetter = getDayLetter(dateStr);
        if (!positionIsActiveOn(pos, dayLetter)) return;
        const absDay = monthStartGlobalDayIndex + di;
        const slot = (absDay + offset) % cycleLen;
        if (slot < workDays) set.add(dateStr);
    });

    return set;
}
