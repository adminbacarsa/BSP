import type { V2Assignment, V2PositionDef, V2ShiftDef } from './autoScheduleEngineV2';
import { effectiveShiftsForPositionDay, isCustomCoverPosition, positionIsActiveOn } from './autoScheduleEngineV2';
import { positionCoverageKind } from './positionCoverageKind';
import { RET_STANDBY_REFERENCE_HOURS } from './constants';

const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V'] as const;

export type CustomRestCode = 'F' | 'FF' | 'RET';

/** Contexto para RET rotativo sábado/domingo en custom L–V ≤8h. */
export interface CustomWeekendRestOptions {
    empId: string;
    dateStr: string;
    /** Titulares del puesto (orden del grupo, hasta qty). */
    titularIds?: string[];
}

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
 * Custom L–V con jornada ≤8h: aplica RET rotativo fin de semana.
 */
export function isFixedWeekdayCustomEightHourOrLess(pos: V2PositionDef): boolean {
    return isFixedWeekdayCustomPosition(pos) && customCoverMaxShiftHours(pos) <= 8;
}

/** Semana ISO (1–53) para alternar RET sábado/domingo sin date-fns en el bundle SSR. */
function isoWeekNumber(dateStr: string): number {
    const d = new Date(`${dateStr}T12:00:00`);
    const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    return Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

/**
 * true → RET el sábado y F el domingo; false → F sábado y RET domingo.
 * - 1 titular: alterna por semana ISO (par=sábado, impar=domingo).
 * - 2+ titulares: intercalados (uno RET sáb, otro RET dom) e invierten cada semana.
 */
export function customWeekendRetOnSaturday(
    empId: string,
    dateStr: string,
    titularIds: string[],
): boolean {
    const weekFlip = isoWeekNumber(dateStr) % 2;
    const rank = Math.max(0, titularIds.indexOf(empId));
    if (titularIds.length <= 1) {
        return weekFlip === 0;
    }
    return (rank + weekFlip) % 2 === 0;
}

/** Contexto del objetivo para intercalar RET fin de semana entre puestos custom L–V ≤8h. */
export interface CustomWeekendPoolScope {
    positions: V2PositionDef[];
    positionGroups: Record<string, string[]>;
}

/**
 * Pool ordenado de guardias que comparten rotación RET sábado/domingo.
 * Agrupa todos los titulares de puestos custom L–V ≤8h del mismo objetivo
 * (ej. Puesto Mañana + Puesto Tarde con qty 1 cada uno).
 */
export function buildCustomWeekendInterleavePool(
    positions: V2PositionDef[],
    positionGroups?: Record<string, string[]>,
): string[] {
    if (!positionGroups) return [];
    const pool: string[] = [];
    const seen = new Set<string>();
    const weekendCustom = [...positions]
        .filter((p) => isFixedWeekdayCustomEightHourOrLess(p))
        .sort((a, b) => a.positionName.localeCompare(b.positionName, 'es'));
    for (const pos of weekendCustom) {
        for (const id of positionGroups[pos.positionName] ?? []) {
            if (!id || seen.has(id)) continue;
            seen.add(id);
            pool.push(id);
        }
    }
    return pool;
}

export function buildCustomWeekendRestOptions(
    pos: V2PositionDef,
    empId: string,
    dateStr: string,
    groupMemberIds?: string[],
    poolScope?: CustomWeekendPoolScope,
): CustomWeekendRestOptions | undefined {
    if (!isFixedWeekdayCustomEightHourOrLess(pos)) return undefined;
    const crossPool = poolScope
        ? buildCustomWeekendInterleavePool(poolScope.positions, poolScope.positionGroups)
        : [];
    let titularIds: string[];
    if (crossPool.length >= 2) {
        titularIds = crossPool;
    } else {
        const qty = customCoverDailyPax(pos);
        const fromGroup = (groupMemberIds ?? []).filter((id) => id).slice(0, qty);
        titularIds = fromGroup.length > 0 ? fromGroup : crossPool.length === 1 ? crossPool : [empId];
    }
    return { empId, dateStr, titularIds };
}

/**
 * Descanso en días sin servicio del puesto custom L–V.
 * - ≤8h: RET rotativo sábado/domingo (mejor oferta stand-by).
 * - >8h (10h, 12h…): F sábado y domingo.
 * No se planifica FF en fin de semana: FF es conversión operativa post-RET.
 */
export function francoCodeForPositionDay(
    pos: V2PositionDef,
    dayLetter: string,
    weekendRest?: CustomWeekendRestOptions,
): CustomRestCode {
    if (positionIsActiveOn(pos, dayLetter)) return 'F';
    if (isFixedWeekdayCustomPosition(pos)) {
        if (customCoverMaxShiftHours(pos) > 8) {
            return 'F';
        }
        if (dayLetter === 'S' || dayLetter === 'D') {
            if (weekendRest?.empId && weekendRest.dateStr) {
                const titularIds = weekendRest.titularIds?.length
                    ? weekendRest.titularIds
                    : [weekendRest.empId];
                const retOnSaturday = customWeekendRetOnSaturday(
                    weekendRest.empId,
                    weekendRest.dateStr,
                    titularIds,
                );
                if (dayLetter === 'S') return retOnSaturday ? 'RET' : 'F';
                return retOnSaturday ? 'F' : 'RET';
            }
            if (dayLetter === 'S') return 'RET';
            return 'F';
        }
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

/** Guardia titular de un puesto custom (MA/ME/RO/M fijo L–V), según grupos del motor. */
export function employeeAssignedToCustomCover(
    empId: string,
    positions: V2PositionDef[],
    positionGroups?: Record<string, string[]>,
): boolean {
    if (!positionGroups) return false;
    for (const [posName, ids] of Object.entries(positionGroups)) {
        if (!ids.includes(empId)) continue;
        const pos = positions.find((p) => p.positionName === posName);
        return !!pos && isCustomCoverPosition(pos);
    }
    return false;
}

/** Titular efectivo custom (dentro de qty); el 2.º+ del grupo es excedente, no titular. */
export function isCustomCoverTitular(
    empId: string,
    positions: V2PositionDef[],
    positionGroups?: Record<string, string[]>,
): boolean {
    if (!positionGroups) return false;
    for (const [posName, ids] of Object.entries(positionGroups)) {
        const rank = ids.indexOf(empId);
        if (rank < 0) continue;
        const pos = positions.find((p) => p.positionName === posName);
        if (!pos || !isCustomCoverPosition(pos)) continue;
        const cap = Math.max(1, Number(pos.qty) || 1);
        return rank < cap;
    }
    return false;
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
    dateStr?: string,
    positionGroups?: Record<string, string[]>,
): CustomRestCode | null {
    const pos = resolveCustomCoverEmployeePosition(empId, positions, defaultPositionByEmp);
    if (!pos) return null;
    if (positionIsActiveOn(pos, dayLetter)) return null;
    const weekendRest = dateStr
        ? buildCustomWeekendRestOptions(
            pos,
            empId,
            dateStr,
            positionGroups?.[pos.positionName],
            positions && positionGroups
                ? { positions, positionGroups }
                : undefined,
        )
        : undefined;
    return francoCodeForPositionDay(pos, dayLetter, weekendRest);
}

export function isPlannedCustomCoverRetAssignment(
    empId: string,
    dayLetter: string,
    positions: V2PositionDef[],
    defaultPositionByEmp?: Record<string, string>,
    dateStr?: string,
    positionGroups?: Record<string, string[]>,
): boolean {
    return plannedCustomCoverRestCode(
        empId,
        dayLetter,
        positions,
        defaultPositionByEmp,
        dateStr,
        positionGroups,
    ) === 'RET';
}

/**
 * Pax en servicio simultáneo del puesto custom (personas a la vez en el puesto).
 * M+T+N cupos: qty guardias cubriendo bandas (no qty×bandas si qty ya es plantilla del puesto).
 */
export function customCoverSimultaneousPax(pos: V2PositionDef): number {
    if (positionCoverageKind(pos) === 'custom_concurrent_mtn') {
        let peak = 0;
        for (const day of ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const) {
            peak = Math.max(peak, customCoverSlotsRequiredOnDay(pos, day));
        }
        return Math.max(1, peak);
    }
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
    if (positionCoverageKind(pos) === 'custom_concurrent_mtn') {
        const perBand = Math.max(1, Math.ceil(qty / bands.length));
        return bands.length * perBand;
    }
    return qty * bands.length;
}

/**
 * Guardias en plantilla del puesto custom.
 * - L–V u horario acotado: qty (francos en días sin servicio).
 * - 7 días/semana: ceil(qty × cicloSemanal / díasTrabajo) para que siempre haya qty en turno
 *   con francos escalonados (ej. 4 pax MA → 5 guardias en 6+1 semanal).
 */
export function customCoverRequiredHeadcount(pos: V2PositionDef): number {
    const simultaneous = customCoverSimultaneousPax(pos);
    if (!customPositionOperatesAllWeek(pos)) {
        return simultaneous;
    }
    const { workDays, cycleLen } = customCoverWeeklyWorkRest(pos);
    return Math.ceil((simultaneous * cycleLen) / workDays);
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

    if (headcount === 3 && qty === 2 && workDays === 6 && cycleLen === 7) {
        const triplePairs: number[][] = [[0, 1], [0, 2], [1, 2]];
        const idx = ((absDayIndex % triplePairs.length) + triplePairs.length) % triplePairs.length;
        return triplePairs[idx] ?? triplePairs[0];
    }

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

const POOL_CYCLE_MAP: Record<string, [number, number]> = {
    '4+2': [4, 2],
    '5+1': [5, 1],
    '6+1': [6, 1],
    '6+2': [6, 2],
};

/** Etiqueta operativa del patrón (ej. 5+1 → XXXXXF). */
export function customPoolCyclePatternLabel(cycleKey: string): string {
    const [work, rest] = POOL_CYCLE_MAP[cycleKey] ?? POOL_CYCLE_MAP['5+1'];
    return `${'X'.repeat(work)}${rest > 0 ? 'F' : ''}`;
}

/** Francos escalonados por día operativo: dotación − cupos simultáneos. */
export { francosPerOperationalDay, poolCycleOffsetForEmployee, buildPoolCycleOffsetByEmp, buildObjectivePoolCycleWorkDays, type BuildObjectivePoolCycleWorkDaysParams } from './poolCycleBootstrap';

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

/** Objetivo CCT aproximado para top-up RET en perfil L–D / 9h / 3 guardias / pax 2. */
export const BALANCED_LD_NINE_HOUR_RET_TOPUP_TARGET = 200;

/**
 * Perfil: custom L–D, una banda M/T ~9h (ciclo 6+1), pax 2, plantilla 3 con rotación 2+1.
 * No aplica a otros custom (L–V, 12h, multi-banda, pax distinto, etc.).
 */
export function isBalancedLdNineHourRetTopUpProfile(
    pos: V2PositionDef,
    groupHeadcount: number,
): boolean {
    if (!isCustomCoverPosition(pos)) return false;
    if (!customPositionOperatesAllWeek(pos)) return false;
    if (customCoverDailyPax(pos) !== 2) return false;
    if (customCoverDistinctBandCount(pos) !== 1) return false;
    if (groupHeadcount !== 3) return false;
    const { workDays, cycleLen } = customCoverWeeklyWorkRest(pos);
    if (workDays !== 6 || cycleLen !== 7) return false;
    const working = (pos.shifts || []).filter(
        (s) => !FRANCO_CODES.has(String(s.code ?? '').toUpperCase()),
    );
    const hrs = Number(working[0]?.hours) || 8;
    return hrs >= 8 && hrs < 11;
}

function billableHoursForEmp(assignments: V2Assignment[], empId: string): number {
    let total = 0;
    for (const a of assignments) {
        if (a.empId !== empId) continue;
        const h = Number(a.hours) || 0;
        if (h <= 0) continue;
        const code = String(a.code ?? '').toUpperCase();
        if (FRANCO_CODES.has(code) || code === 'RET') continue;
        total += h;
    }
    return total;
}

function francoCandidatesForEmp(
    assignments: V2Assignment[],
    empId: string,
    orderedDateStrs?: string[],
): V2Assignment[] {
    const francos = assignments.filter((a) => {
        if (a.empId !== empId) return false;
        const code = String(a.code ?? '').toUpperCase();
        if (code !== 'F') return false;
        if ((Number(a.hours) || 0) > 0) return false;
        const hasBillable = assignments.some((x) =>
            x.empId === empId
            && x.dateStr === a.dateStr
            && (Number(x.hours) || 0) > 0,
        );
        return !hasBillable;
    });
    if (!orderedDateStrs?.length) {
        return francos.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    }
    const order = new Map(orderedDateStrs.map((d, i) => [d, i]));
    return francos.sort((a, b) => {
        const ia = order.get(a.dateStr) ?? 9999;
        const ib = order.get(b.dateStr) ?? 9999;
        return ia - ib;
    });
}

function retTopUpCountForBillable(billable: number, availableF: number): number {
    if (availableF <= 0) return 0;
    if (billable >= BALANCED_LD_NINE_HOUR_RET_TOPUP_TARGET) return 0;
    const deficit = BALANCED_LD_NINE_HOUR_RET_TOPUP_TARGET - billable;
    const byDeficit = Math.floor(deficit / RET_STANDBY_REFERENCE_HOURS);
    const maxPerEmp = billable < 185 ? 2 : 1;
    return Math.min(Math.max(0, byDeficit), maxPerEmp, availableF);
}

function pickFrancoAssignmentsForRet(
    candidates: V2Assignment[],
    retNeeded: number,
): V2Assignment[] {
    if (retNeeded <= 0 || candidates.length === 0) return [];
    if (retNeeded === 1) return [candidates[0]];
    if (candidates.length === 1) return [candidates[0]];
    const mid = Math.floor(candidates.length / 2);
    return [candidates[0], candidates[mid]];
}

export interface BalancedLdNineHourRetTopUpParams {
    assignments: V2Assignment[];
    positions: V2PositionDef[];
    positionGroups: Record<string, string[]>;
    orderedDateStrs?: string[];
}

export interface BalancedLdNineHourRetTopUpResult {
    appliedPositions: string[];
    convertedByEmp: Record<string, number>;
}

/**
 * Convierte F planificados → RET stand-by (0h; no suma a liquidación salvo activación operativa).
 * Solo en puestos que cumplen `isBalancedLdNineHourRetTopUpProfile`.
 */
export function applyBalancedLdNineHourRetCctTopUp(
    params: BalancedLdNineHourRetTopUpParams,
): BalancedLdNineHourRetTopUpResult {
    const { assignments, positions, positionGroups, orderedDateStrs } = params;
    const appliedPositions: string[] = [];
    const convertedByEmp: Record<string, number> = {};

    for (const pos of positions) {
        const groupIds = positionGroups[pos.positionName] ?? [];
        if (!isBalancedLdNineHourRetTopUpProfile(pos, groupIds.length)) continue;

        let positionConverted = 0;
        for (const empId of groupIds) {
            const billable = billableHoursForEmp(assignments, empId);
            const candidates = francoCandidatesForEmp(assignments, empId, orderedDateStrs);
            const existingBalancedRet = assignments.filter((a) =>
                a.empId === empId && a.balancedLdCctRet === true,
            ).length;
            const retNeeded = retTopUpCountForBillable(billable, candidates.length) - existingBalancedRet;
            if (retNeeded <= 0) continue;

            const alreadyRetDates = new Set(
                assignments
                    .filter((a) => a.empId === empId && String(a.code).toUpperCase() === 'RET')
                    .map((a) => a.dateStr),
            );
            const openCandidates = candidates.filter((a) => !alreadyRetDates.has(a.dateStr));
            const toConvert = pickFrancoAssignmentsForRet(openCandidates, retNeeded);
            for (const a of toConvert) {
                a.code = 'RET';
                a.name = 'Retén';
                a.hours = 0;
                a.startTime = '00:00';
                a.isFranco = false;
                a.isReten = true;
                a.balancedLdCctRet = true;
                a.positionName = '';
                convertedByEmp[empId] = (convertedByEmp[empId] || 0) + 1;
                positionConverted++;
            }
        }

        if (positionConverted > 0) {
            appliedPositions.push(pos.positionName);
        }
    }

    return { appliedPositions, convertedByEmp };
}

/** Recalcula contadores RET stand-by desde assignments finales. */
export function recomputeRetPotentialStats(
    assignments: Array<Pick<V2Assignment, 'empId' | 'code'>>,
): {
    employeeRetCount: Record<string, number>;
    employeeRetHoursPotential: Record<string, number>;
    totalRetCount: number;
    totalRetHoursPotential: number;
} {
    const employeeRetCount: Record<string, number> = {};
    for (const a of assignments) {
        if (String(a.code || '').toUpperCase() !== 'RET' || !a.empId) continue;
        employeeRetCount[a.empId] = (employeeRetCount[a.empId] || 0) + 1;
    }
    const employeeRetHoursPotential: Record<string, number> = {};
    let totalRetCount = 0;
    for (const [empId, count] of Object.entries(employeeRetCount)) {
        employeeRetHoursPotential[empId] = count * RET_STANDBY_REFERENCE_HOURS;
        totalRetCount += count;
    }
    return {
        employeeRetCount,
        employeeRetHoursPotential,
        totalRetCount,
        totalRetHoursPotential: totalRetCount * RET_STANDBY_REFERENCE_HOURS,
    };
}
