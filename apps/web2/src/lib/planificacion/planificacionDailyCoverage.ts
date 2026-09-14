import { effectiveShiftsForPositionDay } from '@/lib/planificacion/autoScheduleEngineV4';
import { posAsEngineDef } from '@/lib/planificacion/planificacionPositionEngine';
import {
    getPlanningExcludedShiftCodesOnDate,
    getPlanningExcludedShiftPaxOnDate,
    isPlanningPositionExcludedOnDate,
    isPlanningShiftExcludedOnDate,
    isPlanningWorkShiftCode,
} from '@/lib/slaPlanningMatch';

export const PLANNING_REST_SHIFT_CODES = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET', 'REF', 'ESC']);

/** Horas SLA del día según bandas activas (respeta shift.days, fechas específicas y exclusiones parciales). */
export function dailyCoverageHoursTargetForPos(pos: any, dayLetter: string, cycles?: string[], dateStr?: string): number {
    const coverageType = String(pos?.coverageType || 'custom').toLowerCase();
    if (coverageType === '24hs' || coverageType === '24' || coverageType === '24h') {
        if (dateStr && isPlanningPositionExcludedOnDate(pos, dateStr)) return 0;
        const hasPartial = dateStr && (
            getPlanningExcludedShiftCodesOnDate(pos, dateStr).length > 0
            || Object.keys(getPlanningExcludedShiftPaxOnDate(pos, dateStr)).length > 0
        );
        if (!hasPartial) return 24;
    }
    let eff = effectiveShiftsForPositionDay(posAsEngineDef(pos), dayLetter, cycles, dateStr);
    if (dateStr) {
        const skip = new Set(getPlanningExcludedShiftCodesOnDate(pos, dateStr));
        const paxCuts = getPlanningExcludedShiftPaxOnDate(pos, dateStr);
        if (skip.size > 0) eff = eff.filter((s) => !skip.has(String(s.code || '').toUpperCase()));
        if (Object.keys(paxCuts).length > 0) {
            eff = eff.filter((s) => {
                const code = String(s.code || '').toUpperCase();
                const cut = paxCuts[code] || 0;
                if (cut <= 0) return true;
                const base = (s as any).quantity != null && Number((s as any).quantity) > 0
                    ? Math.floor(Number((s as any).quantity))
                    : Math.max(1, Number(pos?.qty) || 1);
                return base - cut > 0;
            });
        }
    }
    if (eff.length > 0) {
        return eff.reduce((acc, s) => acc + (Number(s.hours) || 8), 0);
    }
    const dayShifts = (pos?.shifts || []).filter((s: any) => {
        const code = String(s.code || '').toUpperCase();
        if (dateStr && isPlanningShiftExcludedOnDate(pos, dateStr, code)) return false;
        if (Array.isArray(s.specificDates) && s.specificDates.length > 0) {
            return dateStr ? s.specificDates.includes(dateStr) : false;
        }
        if (Array.isArray(s.days) && s.days.length > 0) return s.days.includes(dayLetter);
        return true;
    });
    const sum = dayShifts.reduce((acc: number, s: any) => acc + (Number(s.hours) || 8), 0);
    return sum > 0 ? sum : 8;
}

/** Horas SLA del día con PAX por turno. Para custom: suma shift.quantity × shift.hours; fallback globalPax × suma. */
export function dailyCoverageHoursTargetWithPerShiftPax(
    pos: any,
    globalPax: number,
    dayLetter: string,
    cycles?: string[],
    dateStr?: string,
): number {
    const coverageType = String(pos?.coverageType || 'custom').toLowerCase();
    if (coverageType === '24hs' || coverageType === '24' || coverageType === '24h') return 24 * globalPax;
    const eff = effectiveShiftsForPositionDay(posAsEngineDef(pos), dayLetter, cycles, dateStr);
    const shifts: any[] = eff.length > 0 ? eff : (pos?.shifts || []).filter((s: any) => {
        if (Array.isArray(s.specificDates) && s.specificDates.length > 0) {
            return dateStr ? s.specificDates.includes(dateStr) : false;
        }
        if (Array.isArray(s.days) && s.days.length > 0) return s.days.includes(dayLetter);
        return true;
    });
    if (shifts.length === 0) return globalPax * 8;
    const paxCuts = dateStr ? getPlanningExcludedShiftPaxOnDate(pos, dateStr) : {};
    const fullSkip = dateStr ? new Set(getPlanningExcludedShiftCodesOnDate(pos, dateStr)) : new Set<string>();
    const hasPerShiftPax = shifts.some((s: any) => (s as any).quantity != null && Number((s as any).quantity) > 0)
        || Object.keys(paxCuts).length > 0;
    if (!hasPerShiftPax) {
        const sum = shifts.reduce((acc: number, s: any) => {
            const code = String(s.code || '').toUpperCase();
            if (fullSkip.has(code)) return acc;
            return acc + (Number(s.hours) || 8);
        }, 0);
        return globalPax * (sum > 0 ? sum : 8);
    }
    return shifts.reduce((acc: number, s: any) => {
        const code = String(s.code || '').toUpperCase();
        if (fullSkip.has(code)) return acc;
        const sq = (s as any).quantity;
        const base = (sq != null && Number(sq) > 0) ? Math.floor(Number(sq)) : globalPax;
        const sp = Math.max(0, base - (paxCuts[code] || 0));
        if (sp <= 0) return acc;
        return acc + sp * (Number(s.hours) || 8);
    }, 0);
}

export function filterShiftsForPlanningDay(
    shifts: any[],
    pos: any,
    dayLetter: string,
    dateStr: string | undefined,
    cycles?: string[],
): any[] {
    if (!shifts?.length) return [];
    const skipCodes = dateStr ? new Set(getPlanningExcludedShiftCodesOnDate(pos, dateStr)) : new Set<string>();
    const fullExcluded = dateStr ? isPlanningPositionExcludedOnDate(pos, dateStr) : false;
    const ct = String(pos?.coverageType ?? '').toLowerCase();
    if (ct === '24hs' || ct === 'custom') {
        return shifts.filter((s: any) => {
            const code = String(s.code || '').toUpperCase();
            if (PLANNING_REST_SHIFT_CODES.has(code)) return true;
            if (fullExcluded && isPlanningWorkShiftCode(code)) return false;
            if (skipCodes.has(code)) return false;
            if (Array.isArray(s.specificDates) && s.specificDates.length > 0) {
                return dateStr ? s.specificDates.includes(dateStr) : false;
            }
            if (Array.isArray(s.days) && s.days.length > 0) return s.days.includes(dayLetter);
            return true;
        });
    }
    const eff = effectiveShiftsForPositionDay(posAsEngineDef(pos), dayLetter, cycles, dateStr);
    const effCodes = new Set(eff.map((s) => String(s.code || '').toUpperCase()));
    return shifts.filter((s: any) => {
        const code = String(s.code || '').toUpperCase();
        if (PLANNING_REST_SHIFT_CODES.has(code)) return true;
        if (fullExcluded && isPlanningWorkShiftCode(code)) return false;
        if (skipCodes.has(code)) return false;
        if (effCodes.size > 0) return effCodes.has(code);
        if (Array.isArray(s.days) && s.days.length > 0) return s.days.includes(dayLetter);
        return true;
    });
}

export function isPosExcludedOnDate(pos: any, dateStr: string): boolean {
    return isPlanningPositionExcludedOnDate(pos, dateStr);
}
