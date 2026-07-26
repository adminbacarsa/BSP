import type { V2PositionDef, V2ShiftDef } from './autoScheduleEngineV2';
import { effectiveShiftsForPositionDay, isCustomCoverPosition, positionIsActiveOn } from './autoScheduleEngineV2';

const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V'] as const;

export type CustomRestCode = 'F' | 'FF' | 'RET';

/** Jornada máxima entre turnos habilitados del puesto custom. */
export function customCoverMaxShiftHours(pos: V2PositionDef): number {
    const working = (pos.shifts || []).filter(
        (s) => !FRANCO_CODES.has(String(s.code ?? '').toUpperCase()),
    );
    if (working.length === 0) return 8;
    return working.reduce((m, s) => Math.max(m, Number(s.hours) || 8), 0);
}

/** Puesto custom que no opera sábado/domingo (ej. DIRECTORIO, Museo L–V). */
export function isFixedWeekdayCustomPosition(pos: V2PositionDef): boolean {
    return isCustomCoverPosition(pos) && !customPositionOperatesAllWeek(pos);
}

/**
 * Turno fijo L–V con jornada ≥11h: aplica tope semanal Modo 12 (56h) y racha 56h
 * antes de exigir 35h (permite bloque Lun–Vie sin rotación M/T/N).
 */
export function fixedWeekdayCustomUsesModo12(pos: V2PositionDef): boolean {
    if (!isFixedWeekdayCustomPosition(pos)) return false;
    const working = (pos.shifts || []).filter(
        (s) => !FRANCO_CODES.has(String(s.code ?? '').toUpperCase()),
    );
    const hrs = working.reduce((m, s) => Math.max(m, Number(s.hours) || 8), 0);
    return hrs >= 11;
}

/**
 * Descanso en días sin servicio del puesto custom L–V.
 * - Sábado jornada 8h: RET (stand-by; si no es llamado, operaciones lo pasa a FF al cerrar el turno).
 * - Domingo (y sábado >8h): F (franco planificado; si trabaja → FT).
 * No se planifica FF en fin de semana: FF es conversión operativa post-RET.
 */
export function francoCodeForPositionDay(pos: V2PositionDef, dayLetter: string): CustomRestCode {
    if (positionIsActiveOn(pos, dayLetter)) return 'F';
    if (isFixedWeekdayCustomPosition(pos)) {
        if (dayLetter === 'D') return 'F';
        if (dayLetter === 'S' && customCoverMaxShiftHours(pos) <= 8) return 'RET';
        return 'F';
    }
    return 'FF';
}

/** Puesto custom asignado al guardia (planificacionDotacion o defaultPositionByEmp). */
export function resolveCustomCoverEmployeePosition(
    empId: string,
    positions: V2PositionDef[],
    defaultPositionByEmp?: Record<string, string>,
): V2PositionDef | null {
    const posName = defaultPositionByEmp?.[empId];
    if (!posName) return null;
    const pos = positions.find((p) => p.positionName === posName && isCustomCoverPosition(p));
    return pos ?? null;
}

/**
 * Código de descanso planificado para custom en día sin servicio (ej. sábado RET, domingo F).
 * null si el día es laboral del puesto o el guardia no es custom.
 */
export function plannedCustomCoverRestCode(
    empId: string,
    dayLetter: string,
    positions: V2PositionDef[],
    defaultPositionByEmp?: Record<string, string>,
): CustomRestCode | null {
    const pos = resolveCustomCoverEmployeePosition(empId, positions, defaultPositionByEmp);
    if (!pos) return null;
    if (positionIsActiveOn(pos, dayLetter)) return null;
    return francoCodeForPositionDay(pos, dayLetter);
}

export function isPlannedCustomCoverRetAssignment(
    empId: string,
    dayLetter: string,
    positions: V2PositionDef[],
    defaultPositionByEmp?: Record<string, string>,
): boolean {
    return plannedCustomCoverRestCode(empId, dayLetter, positions, defaultPositionByEmp) === 'RET';
}

/**
 * Pax en servicio simultáneo del puesto custom (lo que pide el SLA por día).
 * Con varias bandas (M + M2…), es qty × bandas en el mismo día operativo.
 */
export function customCoverSimultaneousPax(pos: V2PositionDef): number {
    return customCoverDailyPax(pos) * customCoverDistinctBandCount(pos);
}

/**
 * Pax por turno/banda (campo qty del SLA).
 */
export function customCoverDailyPax(pos: V2PositionDef): number {
    return Math.max(1, Number(pos.qty) || 1);
}

/** Cantidad de bandas/turnos distintos habilitados en el puesto (ej. M + M2 → 2). */
export function customCoverDistinctBandCount(pos: V2PositionDef): number {
    const working = (pos.shifts || []).filter(
        (s) => !FRANCO_CODES.has(String(s.code ?? '').toUpperCase()),
    );
    const codes = new Set(
        working.map((s) => String(s.code ?? '').toUpperCase()).filter(Boolean),
    );
    return Math.max(1, codes.size);
}

/** Bandas activas del puesto custom en un día (respeta ciclo 8h vs 12h). */
export function customCoverBandsForDay(
    pos: V2PositionDef,
    dayLetter: string,
    autoCycles?: string[],
    dateStr?: string,
): V2ShiftDef[] {
    if (!isCustomCoverPosition(pos)) return [];
    return effectiveShiftsForPositionDay(pos, dayLetter, autoCycles, dateStr);
}

/**
 * Slots SLA a cubrir en un día operativo: qty × cada banda activa (ej. P1 M + P1 M2 con pax 1 → 2).
 */
export function customCoverSlotsRequiredOnDay(
    pos: V2PositionDef,
    dayLetter: string,
    autoCycles?: string[],
    dateStr?: string,
): number {
    const qty = customCoverDailyPax(pos);
    const bands = customCoverBandsForDay(pos, dayLetter, autoCycles, dateStr);
    if (bands.length === 0) return 0;
    return qty * bands.length;
}

/**
 * Guardias en plantilla del puesto custom.
 * - L–V u horario acotado: qty (francos en días sin servicio).
 * - 7 días/semana: ceil(qty × cicloSemanal / díasTrabajo) para que siempre haya qty en turno
 *   con francos escalonados (ej. 4 pax MA → 5 guardias en 6+1 semanal).
 */
export function customCoverRequiredHeadcount(pos: V2PositionDef): number {
    const qty = customCoverDailyPax(pos);
    const bandCount = customCoverDistinctBandCount(pos);
    if (!customPositionOperatesAllWeek(pos)) {
        return bandCount > 1 ? qty * bandCount : qty;
    }
    const { workDays, cycleLen } = customCoverWeeklyWorkRest(pos);
    return Math.ceil((qty * cycleLen) / workDays);
}

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
/**
 * Índices de guardias que cubren el día (pax simultáneo) con plantilla > qty.
 * Patrones verificados: 5×12h (5+2) con 3 guardias / pax 2; 9h (6+1) con 5 / pax 4.
 */
export function pickBalancedCustomWorkers(
    absDayIndex: number,
    headcount: number,
    qty: number,
    workDays: number,
    cycleLen: number,
): number[] {
    if (headcount <= 0) return [];
    if (headcount <= qty) {
        return Array.from({ length: headcount }, (_, i) => i);
    }

    const day = ((absDayIndex % cycleLen) + cycleLen) % cycleLen;

    if (headcount === 3 && qty === 2 && workDays === 5 && cycleLen === 7) {
        const weeklyPairs: number[][] = [
            [0, 1], [0, 2], [1, 2], [0, 1], [1, 2], [0, 2], [1, 2],
        ];
        return weeklyPairs[day] ?? weeklyPairs[0];
    }

    if (headcount === 5 && qty === 4 && workDays === 6 && cycleLen === 7) {
        const restIdx = absDayIndex % headcount;
        return Array.from({ length: headcount }, (_, i) => i).filter((i) => i !== restIdx);
    }

    const candidates: number[] = [];
    for (let i = 0; i < headcount; i++) {
        const personalSlot = (absDayIndex + i) % cycleLen;
        if (personalSlot < workDays) candidates.push(i);
    }
    if (candidates.length <= qty) return candidates;
    const skipAt = absDayIndex % candidates.length;
    return candidates.filter((_, idx) => idx !== skipAt).slice(0, qty);
}

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
        const simultaneousPax = customCoverSimultaneousPax(pos);
        const bandCount = customCoverDistinctBandCount(pos);
        const headcount = groupMemberIds.length;
        const idxInGroup = Math.max(0, groupMemberIds.indexOf(empId));

        // Multi-banda fija L–V (ej. Villa María: M + M2, 1 pax c/u): todos los guardias trabajan cada día hábil.
        if (bandCount > 1 && headcount <= simultaneousPax) {
            daysInMonth.forEach((day) => {
                const dateStr = getDateKey(day);
                const dayLetter = getDayLetter(dateStr);
                if (positionIsActiveOn(pos, dayLetter)) set.add(dateStr);
            });
            return set;
        }

        let operationalDayIndex = 0;

        daysInMonth.forEach((day) => {
            const dateStr = getDateKey(day);
            const dayLetter = getDayLetter(dateStr);
            if (!positionIsActiveOn(pos, dayLetter)) return;

            if (headcount <= simultaneousPax) {
                set.add(dateStr);
                return;
            }

            const workers = pickBalancedCustomWorkers(
                operationalDayIndex,
                headcount,
                simultaneousPax,
                WEEKDAY_LETTERS.length,
                WEEKDAY_LETTERS.length,
            );
            operationalDayIndex++;
            if (workers.includes(idxInGroup)) set.add(dateStr);
        });
        return set;
    }

    const { workDays, cycleLen } = customCoverWeeklyWorkRest(pos);
    const idxInGroup = Math.max(0, groupMemberIds.indexOf(empId));
    const headcount = groupMemberIds.length;
    const qty = customCoverDailyPax(pos);
    const simultaneousPax = customCoverSimultaneousPax(pos);
    const useBalancedRoster = headcount > simultaneousPax;

    daysInMonth.forEach((day, di) => {
        const dateStr = getDateKey(day);
        const dayLetter = getDayLetter(dateStr);
        if (!positionIsActiveOn(pos, dayLetter)) return;
        const absDay = monthStartGlobalDayIndex + di;

        if (useBalancedRoster) {
            const workers = pickBalancedCustomWorkers(absDay, headcount, simultaneousPax, workDays, cycleLen);
            if (workers.includes(idxInGroup)) set.add(dateStr);
            return;
        }

        const offset = idxInGroup >= 0 ? idxInGroup % cycleLen : 0;
        const slot = (absDay + offset) % cycleLen;
        if (slot < workDays) set.add(dateStr);
    });

    return set;
}
