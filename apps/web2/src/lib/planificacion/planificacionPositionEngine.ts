import { effectiveShiftsForPositionDay, positionIsActiveOn } from '@/lib/planificacion/autoScheduleEngineV4';

/** Adapta un puesto del SLA/grilla al shape que espera el motor V4. */
export function posAsEngineDef(pos: any) {
    return {
        positionName: String(pos?.positionName ?? ''),
        qty: pos?.qty,
        shifts: pos?.shifts,
        activeDays: pos?.activeDays,
        coverageType: pos?.coverageType,
        excludedDates: pos?.excludedDates,
        excludedShiftDates: pos?.excludedShiftDates,
        excludedShiftPaxDates: pos?.excludedShiftPaxDates,
    };
}

export function isPosActiveOnDay(pos: any, dayLetter: string, dateStr?: string): boolean {
    return positionIsActiveOn(posAsEngineDef(pos), dayLetter, dateStr);
}
