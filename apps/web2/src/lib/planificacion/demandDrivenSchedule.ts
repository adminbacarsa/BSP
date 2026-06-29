/**
 * Generación demand-driven: llena slots SLA (M/T/N por puesto/día) antes de francos.
 */

import { buildObjectiveCoverageDemand, isApretarCronoDay, isApretarScheduleActive, isContingencyApretarDay, isModo12Day, getModo12Days, usesExpandedRetPool, type ObjectiveDayDemand } from './objectiveCoverageDemand';
import {
    effectiveShiftsForPositionDay,
    HARD_MAX_HOURS,
    positionIsActiveOn,
    type V2Assignment,
    type V2EngineContext,
    type V2GenerateStats,
    type V2PositionDef,
    type V2ShiftDef,
} from './autoScheduleEngineV2';
import { SUVICO_POLICY } from './suvicoPolicy';
import { addDaysStr, forbiddenEveningToMorningWithoutBreak, forbiddenNightToMorningWithoutBreak, forbiddenNightToNonNightWithoutBreak } from './restBetweenShifts';
import { assignmentBreaksBandTransition, bandMatchesExpected, normBand, pendulumMatchesApretarSlot } from './rotativeBandGuard';

const FRANCO_SET = new Set(['F', 'FF', 'FP', 'FT']);

const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12, EN: 9 };

function mayUseFrancoWorkedRescue(ctx: V2EngineContext): boolean {
    if (ctx.strictSixTwo === true) return false;
    return ctx.allowFrancoWorkedRescue === true;
}

function mayConvertFrancoToWork(ctx: V2EngineContext): boolean {
    // noFlexSchemeEmployees = true significa ciclo 6+2 puro: F nunca se convierte en turno,
    // incluso si hay un gap estructural de horas. El gap queda como slot sin cubrir.
    if (ctx.noFlexSchemeEmployees === true) return false;
    return ctx.strictSixTwo !== true;
}

function mayFrancoRescueForGap(ctx: V2EngineContext): boolean {
    // En 6+2 estricto no convertir F→turno (rompe FF); cerrar SLA con swaps y días laborables.
    return mayConvertFrancoToWork(ctx);
}

function canAssignBand(
    params: DemandDrivenFillParams,
    empId: string,
    dateStr: string,
    code: string,
    sStart: string,
    sHrs: number,
): boolean {
    if (assignmentBreaksBandTransition(params.assignments, empId, dateStr, code)) return false;
    return params.passesAgreementRest(empId, dateStr, code, sStart, sHrs);
}
const DEFAULT_START: Record<string, string> = { M: '06:00', T: '14:00', N: '22:00', D12: '07:00', N12: '19:00' };

export interface DemandDrivenFillParams {
    ctx: V2EngineContext;
    positionGroups: Record<string, string[]>;
    cycleWorkDays: Record<string, Set<string>>;
    customCoverEmps: Set<string>;
    limitedEmpIds: Set<string>;
    assignments: V2Assignment[];
    stats: V2GenerateStats;
    runtime: Record<string, {
        assignedDays: Set<string>;
        cycleCurrentUsed: number;
        cycleNextUsed: number;
        monthHours: number;
        weekHours: Record<string, number>;
        lastShiftCode: string | null;
        lastShiftStart: number | null;
        lastShiftHours: number | null;
    }>;
    cutoffDay: number;
    shiftHoursH: (sh: V2ShiftDef) => number;
    writeAssignment: (
        empId: string, dateStr: string, positionName: string,
        sCode: string, sName: string, sHrs: number, sStart: string,
        inCurrentCycle: boolean, sEnd?: string,
    ) => void;
    passesAgreementRest: (empId: string, dateStr: string, code: string, start: string | undefined, hrs: number) => boolean;
    empMeta: Record<string, { priorityScore: number }>;
    isCustomCoverPosition: (pos: V2PositionDef) => boolean;
    expectedShiftForDay?: (empId: string, dateStr: string, posName: string) => string | null;
    empAssignedTo?: Record<string, string | null>;
    /** Guardia sobrante (1/objetivo): su RET no se promueve a turno para cerrar huecos locales. */
    retDesignateSet?: Set<string>;
    /** Empleados con esquema intensivo 6+1 (mezcla con 6+2 del resto). */
    flexSchemeEmpIds?: Set<string>;
}

interface TryFillOptions {
    candidatePool?: string[];
    ignoreFixedShift?: boolean;
    ignorePendulum?: boolean;
    preferRemainingBudget?: boolean;
    allowSlaClose?: boolean;
    allowTwelveHourUpgrade?: boolean;
}

function isFrancoAssignment(a: V2Assignment | undefined): boolean {
    if (!a) return false;
    const c = String(a.code || '').toUpperCase();
    return a.isFranco === true || FRANCO_SET.has(c);
}

function isWorkAssignment(a: V2Assignment | undefined): boolean {
    if (!a) return false;
    return (a.hours ?? 0) > 0 && !a.isFranco;
}

/**
 * Franco comprimible: 2° día F consecutivo (6+2 → 6+1 local) o guardia ya en reserva 6+1.
 * No toca el 1er F tras noche ni el único F que garantiza 35h entre bloques.
 */
function isCompressibleFrancoDay(
    params: DemandDrivenFillParams,
    empId: string,
    dateStr: string,
): boolean {
    const { assignments, flexSchemeEmpIds } = params;
    const prevDs = addDaysStr(dateStr, -1);
    const prevA = assignments.find(x => x.empId === empId && x.dateStr === prevDs);
    if (isFrancoAssignment(prevA)) {
        return true;
    }
    if (flexSchemeEmpIds?.has(empId) && isFrancoAssignment(assignments.find(x => x.empId === empId && x.dateStr === dateStr))) {
        const prevWork = isWorkAssignment(prevA);
        if (!prevWork) return false;
        const pc = String(prevA!.code || '').toUpperCase();
        if (pc === 'N' || pc === 'N12') return false;
        return true;
    }
    return false;
}

/** Convierte F → turno SLA si cumple descanso (mezcla 6+1 puntual sin romper N→T). */
function tryFillSlotFromFrancoRescue(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    dateStr: string,
    dayLetter: string,
    code: string,
    inCurrent: boolean,
    options?: { ignorePendulum?: boolean; allowSlaClose?: boolean },
): boolean {
    // En ciclo 6+2 puro no convertir francos en trabajo (rompe la forma 6+2).
    if (params.ctx.noFlexSchemeEmployees === true) return false;
    const {
        assignments, runtime, ctx, shiftHoursH, passesAgreementRest,
        stats, limitedEmpIds, retDesignateSet, flexSchemeEmpIds,
    } = params;
    const authorized = ctx.authorizedOver200Ids;
    const sh = shiftDefForCode(pos, dayLetter, code, ctx.autoCycles, shiftHoursH);
    const sHrs = shiftHoursH(sh);
    const sStart = sh.startTime || DEFAULT_START[code] || '07:00';
    const sEnd = sh.endTime;

    const rotate = ctx.rotateShifts !== false && !!params.expectedShiftForDay;

    const candidates = global24hsEmployeePool(params).filter(empId => {
        if (!options?.allowSlaClose && retDesignateSet?.has(empId)) return false;
        if (ctx.absences[empId]?.has(dateStr)) return false;
        const a = assignments.find(x => x.empId === empId && x.dateStr === dateStr);
        if (!a || !isFrancoAssignment(a)) return false;
        if (ctx.strictSixTwo === true && !isCompressibleFrancoDay(params, empId, dateStr)) return false;
        if (!options?.allowSlaClose && !isCompressibleFrancoDay(params, empId, dateStr)) return false;
        if (rotate && !options?.ignorePendulum) {
            const exp = params.expectedShiftForDay!(empId, dateStr, pos.positionName);
            if (exp && isModo12Day(dateStr, ctx)) {
                if (!pendulumMatchesApretarSlot(exp, code)) return false;
            } else if (exp && !bandMatchesExpected(exp, code)) return false;
        }
        return true;
    });

    const sorted = options?.allowSlaClose
        ? [...candidates].filter(empId =>
            passesAgreementRest(empId, dateStr, code, sStart, sHrs)
            && !assignmentBreaksBandTransition(params.assignments, empId, dateStr, code))
        : sortCandidates(candidates, params, code, inCurrent, { preferRemainingBudget: true });

    for (const empId of sorted) {
        if (!options?.allowSlaClose && !authorized?.has(empId) && cctUsed(runtime, empId, inCurrent, limitedEmpIds.has(empId)) + sHrs > HARD_MAX_HOURS) {
            continue;
        }
        const restOk = options?.allowSlaClose
            ? true
            : ctx.rotateShifts !== false
                ? canAssignBand(params, empId, dateStr, code, sStart, sHrs)
                : passesAgreementRest(empId, dateStr, code, sStart, sHrs);
        if (!restOk) continue;

        const a = assignments.find(x => x.empId === empId && x.dateStr === dateStr)!;
        const st = runtime[empId];
        const wkKey = isoWeekKeyFromDateStr(dateStr);
        st.weekHours[wkKey] = (st.weekHours[wkKey] || 0) + sHrs;
        if (inCurrent) {
            st.cycleCurrentUsed += sHrs;
            stats.employeeCycleHours.current[empId] = st.cycleCurrentUsed;
        } else {
            st.cycleNextUsed += sHrs;
            stats.employeeCycleHours.next[empId] = st.cycleNextUsed;
        }
        st.monthHours += sHrs;
        stats.employeeMonthlyHours[empId] = st.monthHours;
        st.lastWorkDate = dateStr;
        st.lastShiftCode = code;
        st.lastShiftStart = parseHourFromTime(sStart);
        st.lastShiftHours = sHrs;

        a.positionName = pos.positionName;
        a.code = code;
        a.name = sh.name || code;
        a.hours = sHrs;
        a.startTime = sStart;
        if (sEnd) a.endTime = sEnd;
        a.isFranco = false;
        a.isReten = false;

        stats.totalBillableHours += sHrs;
        stats.flexCycleRescues = (stats.flexCycleRescues ?? 0) + 1;
        if (flexSchemeEmpIds?.has(empId)) {
            stats.flexSchemeRescues = (stats.flexSchemeRescues ?? 0) + 1;
        }
        return true;
    }
    return false;
}

/**
 * Cierra huecos SLA usando esquema intensivo puntual (6+1 / comprimir 2° F del par FF).
 * Mezcla con 6+2 del resto del mes; siempre valida descanso CCT.
 */
export function fillDemandGapsWithFlexibleCycle(
    params: DemandDrivenFillParams,
    dayDemands: ObjectiveDayDemand[],
): void {
    const { ctx, isCustomCoverPosition } = params;
    if (ctx.strictSixTwo === true) return;
    if (ctx.noFlexSchemeEmployees === true) return;
    if (ctx.rotateShifts === false) return;

    const orderedDays = [...dayDemands].sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    const bandOrder = ['M', 'T', 'N', 'D12', 'N12'];

    for (let round = 0; round < 8; round++) {
        let progress = false;
        for (const day of orderedDays) {
            if (day.totalPaxUnits <= 0) continue;
            if (isModo12Day(day.dateStr, ctx)) continue;
            const dayNum = parseInt(day.dateStr.split('-')[2], 10);
            const inCurrent = dayNum <= params.cutoffDay;
            for (const code of bandOrder) {
                for (const pd of day.positions) {
                    const pos = ctx.positions.find(p => p.positionName === pd.positionName);
                    if (!pos || isCustomCoverPosition(pos)) continue;
                    const needed = pd.bandSlots[code] || 0;
                    if (needed <= 0) continue;
                    let have = countAssigned(params.assignments, day.dateStr, pd.positionName, code);
                    while (have < needed) {
                        if (tryFillSlotFromFrancoRescue(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            progress = true;
                            continue;
                        }
                        break;
                    }
                }
            }
        }
        recomputeUncoveredStats(params, dayDemands);
        if (!progress || (params.stats.uncoveredSlots ?? 0) <= 0) break;
    }
}

function isAvailableForSlot(
    empId: string,
    dateStr: string,
    code: string,
    params: DemandDrivenFillParams,
    pool: string[],
    fixedShift: Record<string, string>,
): boolean {
    const { customCoverEmps, runtime, ctx, cycleWorkDays } = params;
    if (!pool.includes(empId)) return false;
    if (customCoverEmps.has(empId)) return false;
    if (runtime[empId].assignedDays.has(dateStr)) return false;
    if (ctx.absences[empId]?.has(dateStr)) return false;
    if (!cycleWorkDays[empId]?.has(dateStr)) return false;
    const fx = fixedShift[empId];
    if (fx && normBand(fx) !== normBand(code)) return false;
    return true;
}

function sortCandidates(
    ids: string[],
    params: DemandDrivenFillParams,
    code: string,
    inCurrent: boolean,
    options?: TryFillOptions,
): string[] {
    const { runtime, limitedEmpIds, empMeta } = params;
    const c = normBand(code);
    return [...ids].sort((a, b) => {
        const la = normBand(runtime[a].lastShiftCode);
        const lb = normBand(runtime[b].lastShiftCode);
        const contA = la === c ? 1 : 0;
        const contB = lb === c ? 1 : 0;
        if (contA !== contB) return contB - contA;
        const ha = cctUsed(runtime, a, inCurrent, limitedEmpIds.has(a));
        const hb = cctUsed(runtime, b, inCurrent, limitedEmpIds.has(b));
        if (options?.preferRemainingBudget) {
            const remA = HARD_MAX_HOURS - ha;
            const remB = HARD_MAX_HOURS - hb;
            if (remA !== remB) return remB - remA;
            if (ha >= 192 && hb < 192) return 1;
            if (hb >= 192 && ha < 192) return -1;
        } else if (ha !== hb) {
            return ha - hb;
        }
        return (empMeta[b]?.priorityScore ?? 0) - (empMeta[a]?.priorityScore ?? 0);
    });
}

function cctUsed(
    runtime: DemandDrivenFillParams['runtime'],
    empId: string,
    inCur: boolean,
    limited: boolean,
): number {
    const st = runtime[empId];
    return limited ? st.cycleCurrentUsed + st.cycleNextUsed : (inCur ? st.cycleCurrentUsed : st.cycleNextUsed);
}

function shiftDefForCode(pos: V2PositionDef, dayLetter: string, code: string, autoCycles: string[], shiftHoursH: (sh: V2ShiftDef) => number): V2ShiftDef {
    const dayShifts = effectiveShiftsForPositionDay(pos, dayLetter, autoCycles);
    const found = dayShifts.find(s => String(s.code || '').toUpperCase() === code);
    if (found) return found;
    const hrs = SHIFT_HRS[code] ?? 8;
    return { code, name: code, hours: hrs, startTime: DEFAULT_START[code] || '07:00' };
}

/** Marca F en días de descanso del ciclo antes de llenar SLA (mejora check CCT). */
export function seedDemandDrivenCycleFrancos(
    ctx: V2EngineContext,
    cycleWorkDays: Record<string, Set<string>>,
    assignments: V2Assignment[],
    runtime: DemandDrivenFillParams['runtime'],
): void {
    for (const emp of ctx.employees) {
        const st = runtime[emp.id];
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            if (st.assignedDays.has(dateStr)) continue;
            if (cycleWorkDays[emp.id]?.has(dateStr)) continue;
            assignments.push({
                empId: emp.id,
                dateStr,
                positionName: '',
                code: 'F',
                name: 'Franco',
                hours: 0,
                startTime: '00:00',
                isFranco: true,
            });
            st.assignedDays.add(dateStr);
        }
    }
}

function global24hsEmployeePool(params: DemandDrivenFillParams): string[] {
    const { ctx, positionGroups, isCustomCoverPosition } = params;
    const ids: string[] = [];
    for (const pos of ctx.positions) {
        if (isCustomCoverPosition(pos)) continue;
        const cov = String(pos.coverageType || '').toLowerCase();
        if (cov !== '24hs' && cov !== '24' && cov !== '24h') continue;
        for (const id of positionGroups[pos.positionName] || []) {
            if (!ids.includes(id)) ids.push(id);
        }
    }
    return ids;
}

function tryFillOneSlot(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    dateStr: string,
    dayLetter: string,
    code: string,
    inCurrent: boolean,
    options?: TryFillOptions,
): boolean {
    const {
        ctx, positionGroups, cycleWorkDays, customCoverEmps, limitedEmpIds,
        runtime, shiftHoursH, writeAssignment, passesAgreementRest, empMeta,
        expectedShiftForDay,
    } = params;

    const pool = options?.candidatePool ?? (positionGroups[pos.positionName] || []);
    const fixedShift = options?.ignoreFixedShift ? {} : (ctx.defaultShiftByEmp || {});
    const authorized = ctx.authorizedOver200Ids;
    const rotate = ctx.rotateShifts !== false && !!expectedShiftForDay;

    const available = pool.filter(empId =>
        isAvailableForSlot(empId, dateStr, code, params, pool, fixedShift),
    ).filter(empId => {
        if (!rotate || !expectedShiftForDay || options?.ignorePendulum) return true;
        const exp = expectedShiftForDay(empId, dateStr, pos.positionName);
        if (!exp) return false;
        if (isModo12Day(dateStr, ctx)) {
            return pendulumMatchesApretarSlot(exp, code);
        }
        return bandMatchesExpected(exp, code);
    });

    const candidates = sortCandidates(available, params, code, inCurrent, options);

    const sh = shiftDefForCode(pos, dayLetter, code, ctx.autoCycles, shiftHoursH);
    const sHrs = shiftHoursH(sh);
    const sStart = sh.startTime || DEFAULT_START[code] || '07:00';
    const sEnd = sh.endTime;

    const slotQty = Math.max(1, Number(pos.qty) || 1);
    if (countAssigned(params.assignments, dateStr, pos.positionName, code) >= slotQty) {
        return false;
    }

    const band = normBand(code);
    if ((band === 'T' || band === 'N') && !options?.allowSlaClose && !isModo12Day(dateStr, ctx)) {
        if (countAssigned(params.assignments, dateStr, pos.positionName, 'M') < slotQty) return false;
    }
    if ((code === 'D12' || code === 'N12') && !isModo12Day(dateStr, ctx) && !options?.allowTwelveHourUpgrade) {
        return false;
    }

    for (const empId of candidates) {
        if (!options?.allowSlaClose && !authorized?.has(empId) && cctUsed(runtime, empId, inCurrent, limitedEmpIds.has(empId)) + sHrs > HARD_MAX_HOURS) {
            continue;
        }
        const restOk = options?.allowSlaClose
            ? passesAgreementRest(empId, dateStr, code, sStart, sHrs)
                && !assignmentBreaksBandTransition(params.assignments, empId, dateStr, code)
            : rotate
                ? canAssignBand(params, empId, dateStr, code, sStart, sHrs)
                : passesAgreementRest(empId, dateStr, code, sStart, sHrs);
        if (!restOk) continue;
        writeAssignment(empId, dateStr, pos.positionName, code, sh.name || code, sHrs, sStart, inCurrent, sEnd);
        return true;
    }
    return false;
}

/** Convierte un RET del mismo día en turno facturable si cumple descanso (cierra huecos SLA). */
function tryPromoteRetToSlot(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    dateStr: string,
    dayLetter: string,
    code: string,
    inCurrent: boolean,
): boolean {
    const {
        assignments, runtime, limitedEmpIds, shiftHoursH, passesAgreementRest,
        stats, ctx,
    } = params;
    const authorized = ctx.authorizedOver200Ids;
    const sh = shiftDefForCode(pos, dayLetter, code, ctx.autoCycles, shiftHoursH);
    const sHrs = shiftHoursH(sh);
    const sStart = sh.startTime || DEFAULT_START[code] || '07:00';
    const sEnd = sh.endTime;

    const retIds = global24hsEmployeePool(params).filter(empId => {
        if (params.retDesignateSet?.has(empId)) return false;
        if (params.ctx.ajustarCrono === true) return false;
        if (params.ctx.strictSixTwo === true && !params.cycleWorkDays[empId]?.has(dateStr)) return false;
        const slotCode = normBand(code);
        if (isModo12Day(dateStr, params.ctx) && slotCode !== 'D12' && slotCode !== 'N12') {
            return false;
        }
        const a = assignments.find(x => x.empId === empId && x.dateStr === dateStr);
        return a && String(a.code || '').toUpperCase() === 'RET';
    });
    const candidates = sortCandidates(retIds, params, code, inCurrent, { preferRemainingBudget: true });

    for (const empId of candidates) {
        if (!authorized?.has(empId) && cctUsed(runtime, empId, inCurrent, limitedEmpIds.has(empId)) + sHrs > HARD_MAX_HOURS) {
            continue;
        }
        const restOk = ctx.rotateShifts !== false
            ? canAssignBand(params, empId, dateStr, code, sStart, sHrs)
            : passesAgreementRest(empId, dateStr, code, sStart, sHrs);
        if (!restOk) continue;

        const a = assignments.find(x => x.empId === empId && x.dateStr === dateStr)!;
        const st = runtime[empId];
        const wkKey = isoWeekKeyFromDateStr(dateStr);
        st.weekHours[wkKey] = (st.weekHours[wkKey] || 0) + sHrs;
        if (inCurrent) {
            st.cycleCurrentUsed += sHrs;
            stats.employeeCycleHours.current[empId] = st.cycleCurrentUsed;
        } else {
            st.cycleNextUsed += sHrs;
            stats.employeeCycleHours.next[empId] = st.cycleNextUsed;
        }
        st.monthHours += sHrs;
        stats.employeeMonthlyHours[empId] = st.monthHours;
        st.lastWorkDate = dateStr;
        st.lastShiftCode = code;
        st.lastShiftStart = parseHourFromTime(sStart);
        st.lastShiftHours = sHrs;

        a.positionName = pos.positionName;
        a.code = code;
        a.name = sh.name || code;
        a.hours = sHrs;
        a.startTime = sStart;
        if (sEnd) a.endTime = sEnd;
        a.isReten = false;
        a.isFranco = false;

        stats.totalBillableHours += sHrs;
        return true;
    }
    return false;
}

function parseHourFromTime(s: string | undefined): number | null {
    if (!s) return null;
    const m = String(s).match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return Number(m[1]) + Number(m[2]) / 60;
}

/** Reasigna a otro puesto/banda el mismo día si cierra un hueco SLA sin romper descanso. */
function tryReassignWorkerToGap(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    dateStr: string,
    dayLetter: string,
    code: string,
    inCurrent: boolean,
): boolean {
    const {
        assignments, passesAgreementRest, shiftHoursH, ctx, isCustomCoverPosition,
    } = params;
    const sh = shiftDefForCode(pos, dayLetter, code, ctx.autoCycles, shiftHoursH);
    const sHrs = shiftHoursH(sh);
    const sStart = sh.startTime || DEFAULT_START[code] || '07:00';
    const sEnd = sh.endTime;
    const targetCode = normBand(code);

    const dayWork = assignments.filter(a =>
        a.dateStr === dateStr &&
        (a.hours ?? 0) > 0 &&
        !a.isFranco &&
        a.positionName &&
        normBand(a.code) !== targetCode,
    );

    for (const donor of dayWork) {
        const donorPos = ctx.positions.find(p => p.positionName === donor.positionName);
        if (!donorPos || isCustomCoverPosition(donorPos)) continue;
        const restOk = ctx.rotateShifts !== false
            ? canAssignBand(params, donor.empId, dateStr, targetCode, sStart, sHrs)
            : passesAgreementRest(donor.empId, dateStr, targetCode, sStart, sHrs);
        if (!restOk) continue;

        const saved = { ...donor };
        donor.positionName = pos.positionName;
        donor.code = targetCode;
        donor.name = sh.name || targetCode;
        donor.hours = sHrs;
        donor.startTime = sStart;
        if (sEnd) donor.endTime = sEnd;

        const donorCode = normBand(saved.code);
        const donorSh = shiftDefForCode(donorPos, dayLetter, donorCode, ctx.autoCycles, shiftHoursH);
        const dHrs = shiftHoursH(donorSh);
        const dStart = donorSh.startTime || DEFAULT_START[donorCode] || '07:00';

        if (
            tryPromoteRetToSlot(params, donorPos, dateStr, dayLetter, donorCode, inCurrent)
            || tryFillOneSlot(params, donorPos, dateStr, dayLetter, donorCode, inCurrent, {
                candidatePool: global24hsEmployeePool(params),
                ignoreFixedShift: true,
                preferRemainingBudget: true,
            })
        ) {
            return true;
        }

        Object.assign(donor, saved);
    }
    return false;
}

function countAssigned(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    code: string,
): number {
    return assignments.filter(a =>
        a.dateStr === dateStr &&
        a.positionName === positionName &&
        String(a.code).toUpperCase() === code &&
        (a.hours ?? 0) > 0,
    ).length;
}

/** Cobertura efectiva M/T/N (D12≡M, N12≡N, par D12+N12 cubre T si no hay tarde 8h). */
function effectiveMtnCoverage(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    qty: number,
): { M: number; T: number; N: number } {
    const m = countAssigned(assignments, dateStr, positionName, 'M')
        + countAssigned(assignments, dateStr, positionName, 'D12');
    const n = countAssigned(assignments, dateStr, positionName, 'N')
        + countAssigned(assignments, dateStr, positionName, 'N12');
    let t = countAssigned(assignments, dateStr, positionName, 'T');
    const d12 = countAssigned(assignments, dateStr, positionName, 'D12');
    const n12 = countAssigned(assignments, dateStr, positionName, 'N12');
    if (t < qty && d12 >= qty && n12 >= qty) t = qty;
    return { M: m, T: t, N: n };
}

function positionDayMtnGap(
    assignments: V2Assignment[],
    dateStr: string,
    pd: { positionName: string; bandSlots: Record<string, number> },
    qty: number,
): boolean {
    const eff = effectiveMtnCoverage(assignments, dateStr, pd.positionName, qty);
    return (eff.M < (pd.bandSlots.M || 0))
        || (eff.T < (pd.bandSlots.T || 0))
        || (eff.N < (pd.bandSlots.N || 0));
}

function applyBillableUpgrade(
    params: DemandDrivenFillParams,
    a: V2Assignment,
    newHrs: number,
    inCurrent: boolean,
): void {
    const st = params.runtime[a.empId];
    const wkKey = isoWeekKeyFromDateStr(a.dateStr);
    st.weekHours[wkKey] = (st.weekHours[wkKey] || 0) + newHrs;
    if (inCurrent) {
        st.cycleCurrentUsed += newHrs;
        params.stats.employeeCycleHours.current[a.empId] = st.cycleCurrentUsed;
    } else {
        st.cycleNextUsed += newHrs;
        params.stats.employeeCycleHours.next[a.empId] = st.cycleNextUsed;
    }
    st.monthHours += newHrs;
    params.stats.employeeMonthlyHours[a.empId] = st.monthHours;
    params.stats.totalBillableHours = (params.stats.totalBillableHours || 0) + newHrs;
    st.lastShiftCode = a.code;
    st.lastShiftHours = newHrs;
    st.lastShiftStart = parseHourFromTime(a.startTime);
}

function canUpgradeCellTo12h(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    a: V2Assignment,
    dayLetter: string,
    target: 'D12' | 'N12',
    inCurrent: boolean,
): boolean {
    if (!a.positionName || (a.hours ?? 0) <= 0) return false;
    const from = normBand(a.code);
    if (normBand(a.code) === target) return true;
    const validFrom = target === 'D12' ? new Set(['T', 'M']) : new Set(['N']);
    if (!validFrom.has(from)) return false;

    const { shiftHoursH, ctx, runtime, limitedEmpIds } = params;
    const sh = shiftDefForCode(pos, dayLetter, target, ctx.autoCycles, shiftHoursH);
    const sHrs = shiftHoursH(sh);
    const sStart = sh.startTime || DEFAULT_START[target] || (target === 'D12' ? '07:00' : '19:00');
    const oldHrs = Number(a.hours) || 0;
    const delta = sHrs - oldHrs;
    const authorized = ctx.authorizedOver200Ids;
    if (!authorized?.has(a.empId) && cctUsed(runtime, a.empId, inCurrent, limitedEmpIds.has(a.empId)) + delta > HARD_MAX_HOURS) {
        return false;
    }
    return canAssignBand(params, a.empId, a.dateStr, target, sStart, sHrs)
        || params.passesAgreementRest(a.empId, a.dateStr, target, sStart, sHrs);
}

function tryUpgradeCellTo12h(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    a: V2Assignment,
    dayLetter: string,
    target: 'D12' | 'N12',
    inCurrent: boolean,
): boolean {
    if (!canUpgradeCellTo12h(params, pos, a, dayLetter, target, inCurrent)) return false;
    if (normBand(a.code) === target) return true;

    const { shiftHoursH, ctx } = params;
    const sh = shiftDefForCode(pos, dayLetter, target, ctx.autoCycles, shiftHoursH);
    const sHrs = shiftHoursH(sh);
    const sStart = sh.startTime || DEFAULT_START[target] || (target === 'D12' ? '07:00' : '19:00');
    const sEnd = sh.endTime;

    revertBillableCell(params, a);
    a.code = target;
    a.name = sh.name || target;
    a.hours = sHrs;
    a.startTime = sStart;
    if (sEnd) a.endTime = sEnd;
    else delete a.endTime;
    applyBillableUpgrade(params, a, sHrs, inCurrent);
    return true;
}

/** D12 suelto en día rotativo 8h: baja a T para liberar horas y cerrar slot tarde. */
function tryDowngradeOrphanD12ToT(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    a: V2Assignment,
    dayLetter: string,
    inCurrent: boolean,
): boolean {
    if (normBand(a.code) !== 'D12' || isModo12Day(a.dateStr, params.ctx)) return false;
    const qty = Math.max(1, Number(pos.qty) || 1);
    const n12 = countAssigned(params.assignments, a.dateStr, pos.positionName, 'N12');
    if (n12 >= qty) return false;
    if (countAssigned(params.assignments, a.dateStr, pos.positionName, 'T') >= qty) return false;

    const { shiftHoursH, ctx } = params;
    const sh = shiftDefForCode(pos, dayLetter, 'T', ctx.autoCycles, shiftHoursH);
    const newHrs = shiftHoursH(sh);
    const oldHrs = Number(a.hours) || 12;
    const delta = newHrs - oldHrs;
    if (delta === 0) return false;

    const st = params.runtime[a.empId];
    const wkKey = isoWeekKeyFromDateStr(a.dateStr);
    st.weekHours[wkKey] = (st.weekHours[wkKey] || 0) + delta;
    if (inCurrent) {
        st.cycleCurrentUsed += delta;
        params.stats.employeeCycleHours.current[a.empId] = st.cycleCurrentUsed;
    } else {
        st.cycleNextUsed += delta;
        params.stats.employeeCycleHours.next[a.empId] = st.cycleNextUsed;
    }
    st.monthHours += delta;
    params.stats.employeeMonthlyHours[a.empId] = st.monthHours;
    params.stats.totalBillableHours = (params.stats.totalBillableHours || 0) + delta;

    a.code = 'T';
    a.name = sh.name || 'T';
    a.hours = newHrs;
    a.startTime = sh.startTime || DEFAULT_START.T || '14:00';
    if (sh.endTime) a.endTime = sh.endTime;
    else delete a.endTime;
    st.lastShiftCode = 'T';
    st.lastShiftHours = newHrs;
    st.lastShiftStart = parseHourFromTime(a.startTime);
    return true;
}

function repairOrphan12hOnRotativoDays(
    params: DemandDrivenFillParams,
    dayDemands: ObjectiveDayDemand[],
    isCustomCoverPosition: (pos: V2PositionDef) => boolean,
): void {
    const { ctx, assignments } = params;
    for (const day of dayDemands) {
        if (day.totalPaxUnits <= 0 || isModo12Day(day.dateStr, ctx)) continue;
        const dayNum = parseInt(day.dateStr.split('-')[2], 10);
        const inCurrent = dayNum <= params.cutoffDay;
        for (const pd of day.positions) {
            const pos = ctx.positions.find(p => p.positionName === pd.positionName);
            if (!pos || isCustomCoverPosition(pos)) continue;
            const d12Cells = assignments.filter(a =>
                a.dateStr === day.dateStr
                && a.positionName === pd.positionName
                && normBand(a.code) === 'D12'
                && (a.hours ?? 0) > 0,
            );
            for (const cell of d12Cells) {
                tryDowngradeOrphanD12ToT(params, pos, cell, day.dayLetter, inCurrent);
            }
        }
    }
}

/**
 * Cierra huecos M/T/N en un puesto con par D12+N12 (misma lógica que coverageVerification).
 * Aplica en rotativo ON donde el péndulo dejó T+N sin M por descanso CCT.
 */
function tryClosePositionDayWith12hAlternate(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    pd: { positionName: string; bandSlots: Record<string, number>; alternateBandSlots?: Record<string, number> },
    dateStr: string,
    dayLetter: string,
    inCurrent: boolean,
): boolean {
    const { ctx, assignments } = params;
    if (isModo12Day(dateStr, ctx)) return false;
    // En ciclo 6+2 puro (noFlexSchemeEmployees) no subir a D12/N12 para cerrar gaps estructurales:
    // el gap queda como slot sin cubrir; el usuario decide ajustar o agregar personal.
    if (ctx.noFlexSchemeEmployees === true || ctx.strictSixTwo === true) return false;
    if (!pd.alternateBandSlots?.D12 || !pd.alternateBandSlots?.N12) return false;
    const qty = Math.max(1, Number(pos.qty) || 1);
    if (!positionDayMtnGap(assignments, dateStr, pd, qty)) return false;

    const globalPool = global24hsEmployeePool(params);
    const onPos = () => assignments.filter(a =>
        a.dateStr === dateStr && a.positionName === pos.positionName && (a.hours ?? 0) > 0,
    );

    const tCells = onPos().filter(a => normBand(a.code) === 'T');
    const nCells = onPos().filter(a => normBand(a.code) === 'N');
    if (tCells.length >= qty && nCells.length >= qty) {
        let upgraded = true;
        for (let i = 0; i < qty; i++) {
            if (!tryUpgradeCellTo12h(params, pos, tCells[i], dayLetter, 'D12', inCurrent)
                || !tryUpgradeCellTo12h(params, pos, nCells[i], dayLetter, 'N12', inCurrent)) {
                upgraded = false;
                break;
            }
        }
        if (upgraded && !positionDayMtnGap(assignments, dateStr, pd, qty)) return true;
    }

    const mActual = countAssigned(assignments, dateStr, pos.positionName, 'M');
    if (mActual < qty && tCells.length >= qty && nCells.length < qty) {
        if (tryUpgradeCellTo12h(params, pos, tCells[0], dayLetter, 'D12', inCurrent)) {
            let n12 = countAssigned(assignments, dateStr, pos.positionName, 'N12');
            while (n12 < qty) {
                if (!tryFillOneSlot(params, pos, dateStr, dayLetter, 'N12', inCurrent, {
                    candidatePool: globalPool,
                    ignoreFixedShift: true,
                    ignorePendulum: true,
                    preferRemainingBudget: true,
                    allowTwelveHourUpgrade: true,
                })) break;
                n12++;
            }
            if (!positionDayMtnGap(assignments, dateStr, pd, qty)) return true;
        }
    }

    return false;
}

export function recomputeUncoveredStats(params: DemandDrivenFillParams, dayDemands: ObjectiveDayDemand[]): void {
    const { stats, isCustomCoverPosition, ctx, assignments } = params;
    stats.uncoveredSlots = 0;
    stats.uncoveredSlotsByDay = {};
    for (const day of dayDemands) {
        for (const pd of day.positions) {
            const pos = ctx.positions.find(p => p.positionName === pd.positionName);
            if (!pos || isCustomCoverPosition(pos)) continue;
            const qty = Math.max(1, Number(pos.qty) || 1);
            const eff = effectiveMtnCoverage(assignments, day.dateStr, pd.positionName, qty);
            for (const code of ['M', 'T', 'N'] as const) {
                const needed = pd.bandSlots[code] || 0;
                if (needed <= 0) continue;
                const have = eff[code];
                if (have < needed) {
                    recordUncovered(stats, day.dateStr, pd.positionName, code, needed - have);
                }
            }
            for (const [code, needed] of Object.entries(pd.bandSlots)) {
                if (code === 'M' || code === 'T' || code === 'N') continue;
                const have = countAssigned(assignments, day.dateStr, pd.positionName, code);
                if (have < needed) {
                    recordUncovered(stats, day.dateStr, pd.positionName, code, needed - have);
                }
            }
        }
    }
}

/** Último intento antes de francos: llenar huecos del día con guardias aún libres. */
export function fillDemandGapsBeforeFrancos(
    params: DemandDrivenFillParams,
    dayDemands: ObjectiveDayDemand[],
): void {
    const { ctx, isCustomCoverPosition } = params;
    const orderedDays = [...dayDemands].sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    for (const day of orderedDays) {
        if (day.totalPaxUnits <= 0) continue;
        const apretarDay = isModo12Day(day.dateStr, ctx);
        const dayNum = parseInt(day.dateStr.split('-')[2], 10);
        const inCurrent = dayNum <= params.cutoffDay;
        const bandOrder = apretarDay
            ? (['D12', 'N12'] as const)
            : (['M', 'T', 'N', 'D12', 'N12'] as const);
        for (let pass = 0; pass < 7; pass++) {
            const globalPool = pass >= 1 ? global24hsEmployeePool(params) : undefined;
            const ignoreFixed = pass >= 1;
            for (const code of bandOrder) {
                const ignorePendulum = !apretarDay && ctx.rotateShifts !== false
                    && ((pass === 4 && code === 'M') || (pass === 2 && code === 'M') || (pass === 3 && code === 'N'));
                for (const pd of day.positions) {
                    const pos = ctx.positions.find(p => p.positionName === pd.positionName);
                    if (!pos || isCustomCoverPosition(pos)) continue;
                    const needed = pd.bandSlots[code] || 0;
                    if (needed <= 0) continue;
                    const posPool = params.positionGroups[pos.positionName] || [];
                    const pool = pass >= 2 ? posPool : (pass >= 1 ? globalPool : posPool);
                    let have = countAssigned(params.assignments, day.dateStr, pd.positionName, code);
                    while (have < needed) {
                        if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                            candidatePool: pool,
                            ignoreFixedShift: ignoreFixed,
                            ignorePendulum,
                            preferRemainingBudget: pass >= 1,
                        })) {
                            have++;
                            continue;
                        }
                        if (ctx.rotateShifts === false) {
                            if (tryPromoteRetToSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                                have++;
                                continue;
                            }
                        }
                        if (!apretarDay && (pass >= 5 || ctx.rotateShifts === false)
                            && tryReassignWorkerToGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            continue;
                        }
                        if (!apretarDay && pass >= 6 && mayFrancoRescueForGap(ctx)
                            && tryFillSlotFromFrancoRescue(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            continue;
                        }
                        break;
                    }
                }
            }
        }
        if (!apretarDay) {
            for (const pd of day.positions) {
                const pos = ctx.positions.find(p => p.positionName === pd.positionName);
                if (!pos || isCustomCoverPosition(pos)) continue;
                tryClosePositionDayWith12hAlternate(params, pos, pd, day.dateStr, day.dayLetter, inCurrent);
            }
        }
    }
    recomputeUncoveredStats(params, dayDemands);
}

function removePlainFrancoCell(
    params: DemandDrivenFillParams,
    empId: string,
    dateStr: string,
): V2Assignment | null {
    const idx = params.assignments.findIndex(a =>
        a.empId === empId &&
        a.dateStr === dateStr &&
        String(a.code || '').toUpperCase() === 'F' &&
        (a.hours ?? 0) === 0,
    );
    if (idx < 0) return null;
    const cell = params.assignments[idx];
    params.assignments.splice(idx, 1);
    params.runtime[empId]?.assignedDays.delete(dateStr);
    return cell;
}

function restorePlainFrancoCell(params: DemandDrivenFillParams, cell: V2Assignment): void {
    params.assignments.push(cell);
    params.runtime[cell.empId]?.assignedDays.add(cell.dateStr);
}

/** Día laborable del ciclo marcado F por fallback → cubrir hueco SLA (no franco trabajado). */
function tryPromoteCycleWorkFrancoToGap(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    dateStr: string,
    dayLetter: string,
    code: string,
    inCurrent: boolean,
): boolean {
    const { cycleWorkDays, positionGroups } = params;
    const posPool = positionGroups[pos.positionName] || [];
    const pool = [...posPool, ...global24hsEmployeePool(params).filter(id => !posPool.includes(id))];

    for (const empId of pool) {
        if (!cycleWorkDays[empId]?.has(dateStr)) continue;
        const saved = removePlainFrancoCell(params, empId, dateStr);
        if (!saved) continue;

        const filled = tryFillOneSlot(params, pos, dateStr, dayLetter, code, inCurrent, {
            candidatePool: [empId],
            ignoreFixedShift: true,
            ignorePendulum: true,
            preferRemainingBudget: true,
        });
        if (filled) return true;
        restorePlainFrancoCell(params, saved);
    }
    return false;
}

/** Mueve guardia que ya cubre la banda en otro puesto hacia el hueco (misma banda/día). */
function tryMoveSameBandWorkerToGap(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    dateStr: string,
    dayLetter: string,
    code: string,
    inCurrent: boolean,
): boolean {
    const targetCode = normBand(code);
    const { assignments, ctx, shiftHoursH, isCustomCoverPosition } = params;
    const sh = shiftDefForCode(pos, dayLetter, code, ctx.autoCycles, shiftHoursH);
    const sEnd = sh.endTime;

    const donors = assignments.filter(a =>
        a.dateStr === dateStr &&
        a.positionName &&
        a.positionName !== pos.positionName &&
        normBand(a.code) === targetCode &&
        (a.hours ?? 0) > 0,
    );

    for (const donor of donors) {
        const donorPos = ctx.positions.find(p => p.positionName === donor.positionName);
        if (!donorPos || isCustomCoverPosition(donorPos)) continue;

        const saved = { ...donor };
        donor.positionName = pos.positionName;
        donor.name = sh.name || code;
        if (sEnd) donor.endTime = sEnd;

        const filledBack =
            tryFillSlotFromFrancoRescue(params, donorPos, dateStr, dayLetter, targetCode, inCurrent, {
                ignorePendulum: true,
                allowSlaClose: true,
            })
            || (mayUseFrancoWorkedRescue(params.ctx) && tryFillSlotFromFrancoRescue(params, donorPos, dateStr, dayLetter, targetCode, inCurrent, {
                ignorePendulum: true,
                allowSlaClose: true,
            }))
            || bruteForceFrancoToGap(params, donorPos, dateStr, dayLetter, targetCode, inCurrent)
            || tryFillOneSlot(params, donorPos, dateStr, dayLetter, targetCode, inCurrent, {
                candidatePool: global24hsEmployeePool(params),
                ignoreFixedShift: true,
                ignorePendulum: true,
                preferRemainingBudget: true,
                allowSlaClose: true,
            })
            || tryPromoteRetToSlot(params, donorPos, dateStr, dayLetter, targetCode, inCurrent)
            || tryReassignWorkerToGap(params, donorPos, dateStr, dayLetter, targetCode, inCurrent);

        if (filledBack) return true;
        Object.assign(donor, saved);
    }
    return false;
}

/** Mismo puesto/día: cambia banda (ej. T→M) y llena la banda liberada. */
function trySwapBandOnSamePosition(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    dateStr: string,
    dayLetter: string,
    neededCode: string,
    inCurrent: boolean,
): boolean {
    const targetCode = normBand(neededCode);
    const { assignments, ctx, shiftHoursH, passesAgreementRest } = params;
    const donor = assignments.find(a =>
        a.dateStr === dateStr &&
        a.positionName === pos.positionName &&
        (a.hours ?? 0) > 0 &&
        normBand(a.code) !== targetCode,
    );
    if (!donor) return false;

    const sh = shiftDefForCode(pos, dayLetter, neededCode, ctx.autoCycles, shiftHoursH);
    const sHrs = shiftHoursH(sh);
    const sStart = sh.startTime || DEFAULT_START[targetCode] || '07:00';
    const sEnd = sh.endTime;

    if (!canAssignBand(params, donor.empId, dateStr, targetCode, sStart, sHrs)) {
        return false;
    }

    const freedCode = normBand(donor.code);
    const saved = { ...donor };
    donor.code = targetCode;
    donor.name = sh.name || targetCode;
    donor.hours = sHrs;
    donor.startTime = sStart;
    if (sEnd) donor.endTime = sEnd;

    const filled =
        (mayFrancoRescueForGap(params.ctx) && tryFillSlotFromFrancoRescue(params, pos, dateStr, dayLetter, freedCode, inCurrent, {
            ignorePendulum: true,
            allowSlaClose: true,
        }))
        || (mayUseFrancoWorkedRescue(params.ctx) && tryFillSlotFromFrancoRescue(params, pos, dateStr, dayLetter, freedCode, inCurrent, {
            ignorePendulum: true,
            allowSlaClose: true,
        }))
        || tryFillOneSlot(params, pos, dateStr, dayLetter, freedCode, inCurrent, {
            candidatePool: global24hsEmployeePool(params),
            ignoreFixedShift: true,
            ignorePendulum: true,
            preferRemainingBudget: true,
        })
        || tryMoveSameBandWorkerToGap(params, pos, dateStr, dayLetter, freedCode, inCurrent);

    if (filled) return true;
    Object.assign(donor, saved);
    return false;
}

/** Intercambia puesto entre quien tiene la banda faltante y otro puesto con banda distinta (cierra M en Internado). */
function tryCrossPositionTwoWorkerSwapForGap(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    dateStr: string,
    dayLetter: string,
    neededCode: string,
    inCurrent: boolean,
): boolean {
    const targetCode = normBand(neededCode);
    const { assignments, ctx, isCustomCoverPosition, shiftHoursH, passesAgreementRest } = params;

    const gapPosWorkers = assignments.filter(a =>
        a.dateStr === dateStr && a.positionName === pos.positionName && (a.hours ?? 0) > 0,
    );
    const blockers = gapPosWorkers.filter(a => normBand(a.code) !== targetCode);
    if (blockers.length === 0) return false;

    const mDonors = assignments.filter(a =>
        a.dateStr === dateStr &&
        a.positionName &&
        a.positionName !== pos.positionName &&
        normBand(a.code) === targetCode &&
        (a.hours ?? 0) > 0,
    );

    for (const blocker of blockers) {
    for (const donor of mDonors) {
        const donorPos = ctx.positions.find(p => p.positionName === donor.positionName);
        if (!donorPos || isCustomCoverPosition(donorPos)) continue;

        const savedDonor = { ...donor };
        const savedBlocker = { ...blocker };
        const blockerBand = normBand(blocker.code);
        const blockerSh = shiftDefForCode(donorPos, dayLetter, blockerBand, ctx.autoCycles, shiftHoursH);
        const gapSh = shiftDefForCode(pos, dayLetter, targetCode, ctx.autoCycles, shiftHoursH);

        donor.positionName = pos.positionName;
        donor.name = gapSh.name || targetCode;

        blocker.positionName = donorPos.positionName;
        blocker.code = blockerBand;
        blocker.name = blockerSh.name || blockerBand;
        blocker.hours = shiftHoursH(blockerSh);
        blocker.startTime = blockerSh.startTime || DEFAULT_START[blockerBand] || '07:00';
        if (blockerSh.endTime) blocker.endTime = blockerSh.endTime;
        else delete blocker.endTime;

        const ok1 = passesAgreementRest(donor.empId, dateStr, targetCode, donor.startTime, donor.hours ?? 8);
        const ok2 = passesAgreementRest(blocker.empId, dateStr, blockerBand, blocker.startTime, blocker.hours ?? 8);
        if (!ok1 || !ok2) {
            Object.assign(donor, savedDonor);
            Object.assign(blocker, savedBlocker);
            continue;
        }

        const backfill =
            tryFillSlotFromFrancoRescue(params, donorPos, dateStr, dayLetter, targetCode, inCurrent, {
                ignorePendulum: true,
                allowSlaClose: true,
            })
            || bruteForceFrancoToGap(params, donorPos, dateStr, dayLetter, targetCode, inCurrent)
            || tryFillOneSlot(params, donorPos, dateStr, dayLetter, targetCode, inCurrent, {
                candidatePool: global24hsEmployeePool(params),
                ignoreFixedShift: true,
                ignorePendulum: true,
                preferRemainingBudget: true,
                allowSlaClose: true,
            });

        if (backfill) return true;

        Object.assign(donor, savedDonor);
        Object.assign(blocker, savedBlocker);
    }
    }
    return false;
}

/**
 * Guardias en día laborable del ciclo aún sin celda → cubrir huecos SLA (ignore péndulo).
 */
export function assignUnassignedWorkDayEmployeesToGaps(
    params: DemandDrivenFillParams,
    dayDemands: ObjectiveDayDemand[],
): void {
    const { ctx, cycleWorkDays, runtime, isCustomCoverPosition } = params;
    const bandOrder = ['M', 'T', 'N'] as const;
    const orderedDays = [...dayDemands].sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    for (let pass = 0; pass < 6; pass++) {
        let progress = false;
        for (const day of orderedDays) {
            if (day.totalPaxUnits <= 0 || isModo12Day(day.dateStr, ctx)) continue;
            const dayNum = parseInt(day.dateStr.split('-')[2], 10);
            const inCurrent = dayNum <= params.cutoffDay;

            for (const code of bandOrder) {
                for (const pd of day.positions) {
                    const pos = ctx.positions.find(p => p.positionName === pd.positionName);
                    if (!pos || isCustomCoverPosition(pos)) continue;
                    const qty = Math.max(1, Number(pos.qty) || 1);
                    const eff = effectiveMtnCoverage(params.assignments, day.dateStr, pd.positionName, qty);
                    const needed = pd.bandSlots[code] || 0;
                    if (needed <= 0 || eff[code] >= needed) continue;

                    const posPool = params.positionGroups[pos.positionName] || [];
                    const freeWorkers = [...posPool, ...global24hsEmployeePool(params).filter(id => !posPool.includes(id))]
                        .filter(empId =>
                            cycleWorkDays[empId]?.has(day.dateStr) &&
                            !runtime[empId].assignedDays.has(day.dateStr) &&
                            !ctx.absences[empId]?.has(day.dateStr),
                        );

                    for (const empId of freeWorkers) {
                        if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                            candidatePool: [empId],
                            ignoreFixedShift: true,
                            ignorePendulum: true,
                            preferRemainingBudget: true,
                        })) {
                            progress = true;
                            break;
                        }
                    }
                }
            }
        }
        if (!progress) break;
    }
    recomputeUncoveredStats(params, dayDemands);
}

/** Empleado sin celda en día laborable → intentar cerrar cualquier hueco SLA del día. */
export function tryAssignEmployeeToDayGap(
    params: DemandDrivenFillParams,
    dayDemands: ObjectiveDayDemand[],
    empId: string,
    dateStr: string,
    inCurrent: boolean,
): boolean {
    const { ctx, cycleWorkDays, isCustomCoverPosition } = params;
    if (!cycleWorkDays[empId]?.has(dateStr)) return false;
    if (ctx.absences[empId]?.has(dateStr)) return false;
    if (params.runtime[empId].assignedDays.has(dateStr)) return false;

    const day = dayDemands.find(d => d.dateStr === dateStr);
    if (!day || isModo12Day(dateStr, ctx)) return false;

    for (const code of ['M', 'T', 'N'] as const) {
        for (const pd of day.positions) {
            const pos = ctx.positions.find(p => p.positionName === pd.positionName);
            if (!pos || isCustomCoverPosition(pos)) continue;
            const qty = Math.max(1, Number(pos.qty) || 1);
            const eff = effectiveMtnCoverage(params.assignments, dateStr, pd.positionName, qty);
            const needed = pd.bandSlots[code] || 0;
            if (needed <= 0 || eff[code] >= needed) continue;

            if (tryFillOneSlot(params, pos, dateStr, day.dayLetter, code, inCurrent, {
                candidatePool: [empId],
                ignoreFixedShift: true,
                ignorePendulum: true,
                preferRemainingBudget: true,
                allowSlaClose: true,
            })) {
                return true;
            }
        }
    }
    return false;
}

/** Último recurso: cualquier F del día con descanso OK → hueco SLA (cierre 2880h). */
function bruteForceFrancoToGap(
    params: DemandDrivenFillParams,
    pos: V2PositionDef,
    dateStr: string,
    dayLetter: string,
    code: string,
    inCurrent: boolean,
): boolean {
    // En ciclo 6+2 puro no convertir francos en trabajo (rompe la forma 6+2).
    if (params.ctx.noFlexSchemeEmployees === true) return false;
    const { assignments, ctx, shiftHoursH, passesAgreementRest, stats, runtime, limitedEmpIds } = params;
    const sh = shiftDefForCode(pos, dayLetter, code, ctx.autoCycles, shiftHoursH);
    const sHrs = shiftHoursH(sh);
    const sStart = sh.startTime || DEFAULT_START[code] || '07:00';
    const sEnd = sh.endTime;
    const slotQty = Math.max(1, Number(pos.qty) || 1);
    if (countAssigned(assignments, dateStr, pos.positionName, code) >= slotQty) return false;

    for (const emp of ctx.employees) {
        const empId = emp.id;
        if (ctx.absences[empId]?.has(dateStr)) continue;
        const a = assignments.find(x => x.empId === empId && x.dateStr === dateStr);
        if (!a || !isFrancoAssignment(a)) continue;
        if (!passesAgreementRest(empId, dateStr, code, sStart, sHrs)) continue;

        const st = runtime[empId];
        const wkKey = isoWeekKeyFromDateStr(dateStr);
        st.weekHours[wkKey] = (st.weekHours[wkKey] || 0) + sHrs;
        if (inCurrent) {
            st.cycleCurrentUsed += sHrs;
            stats.employeeCycleHours.current[empId] = st.cycleCurrentUsed;
        } else {
            st.cycleNextUsed += sHrs;
            stats.employeeCycleHours.next[empId] = st.cycleNextUsed;
        }
        st.monthHours += sHrs;
        stats.employeeMonthlyHours[empId] = st.monthHours;
        st.lastWorkDate = dateStr;
        st.lastShiftCode = code;
        st.lastShiftStart = parseHourFromTime(sStart);
        st.lastShiftHours = sHrs;

        a.positionName = pos.positionName;
        a.code = code;
        a.name = sh.name || code;
        a.hours = sHrs;
        a.startTime = sStart;
        if (sEnd) a.endTime = sEnd;
        else delete a.endTime;
        a.isFranco = false;
        a.isReten = false;
        stats.totalBillableHours = (stats.totalBillableHours || 0) + sHrs;
        return true;
    }
    return false;
}

/** Repara puestos con M/T/N incompleto (Internado T+N sin M, etc.). */
export function repairPositionDayTripletGaps(
    params: DemandDrivenFillParams,
    dayDemands: ObjectiveDayDemand[],
): void {
    const { ctx, isCustomCoverPosition } = params;
    repairOrphan12hOnRotativoDays(params, dayDemands, isCustomCoverPosition);
    const orderedDays = [...dayDemands].sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    for (let round = 0; round < 8; round++) {
        let progress = false;
        for (const day of orderedDays) {
            if (day.totalPaxUnits <= 0 || isModo12Day(day.dateStr, ctx)) continue;
            const dayNum = parseInt(day.dateStr.split('-')[2], 10);
            const inCurrent = dayNum <= params.cutoffDay;

            for (const pd of day.positions) {
                const pos = ctx.positions.find(p => p.positionName === pd.positionName);
                if (!pos || isCustomCoverPosition(pos)) continue;
                const qty = Math.max(1, Number(pos.qty) || 1);
                if (!positionDayMtnGap(params.assignments, day.dateStr, pd, qty)) continue;

                for (const code of ['M', 'T', 'N'] as const) {
                    const needed = pd.bandSlots[code] || 0;
                    if (needed <= 0) continue;
                    const eff = effectiveMtnCoverage(params.assignments, day.dateStr, pd.positionName, qty);
                    if (eff[code] >= needed) continue;

                    if (mayFrancoRescueForGap(params.ctx) && tryFillSlotFromFrancoRescue(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                        ignorePendulum: true,
                        allowSlaClose: true,
                    })) {
                        progress = true;
                        continue;
                    }
                    if (mayConvertFrancoToWork(params.ctx) && bruteForceFrancoToGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                        progress = true;
                        continue;
                    }
                    if (tryCrossPositionTwoWorkerSwapForGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent)
                        || tryMoveSameBandWorkerToGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent)
                        || (mayConvertFrancoToWork(params.ctx) && tryPromoteCycleWorkFrancoToGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent))) {
                        progress = true;
                    }
                }
                if (tryClosePositionDayWith12hAlternate(params, pos, pd, day.dateStr, day.dayLetter, inCurrent)) {
                    progress = true;
                }
            }
        }
        recomputeUncoveredStats(params, dayDemands);
        if (!progress || (params.stats.uncoveredSlots ?? 0) <= 0) break;
    }
}

/**
 * Último recurso: cierra huecos SLA ignorando péndulo (prioridad cobertura 4/4).
 * Solo aplica descanso CCT y tope 200h.
 */
export function forceCloseRemainingSlaGaps(
    params: DemandDrivenFillParams,
    dayDemands: ObjectiveDayDemand[],
): void {
    const { ctx, isCustomCoverPosition } = params;
    repairOrphan12hOnRotativoDays(params, dayDemands, isCustomCoverPosition);
    const bandOrder = ['M', 'T', 'N', 'D12', 'N12'] as const;
    const orderedDays = [...dayDemands].sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    for (let round = 0; round < 10; round++) {
        let progress = false;
        for (const day of orderedDays) {
            if (day.totalPaxUnits <= 0) continue;
            if (isModo12Day(day.dateStr, ctx)) continue;
            const dayNum = parseInt(day.dateStr.split('-')[2], 10);
            const inCurrent = dayNum <= params.cutoffDay;
            const globalPool = global24hsEmployeePool(params);

            for (const code of bandOrder) {
                for (const pd of day.positions) {
                    const pos = ctx.positions.find(p => p.positionName === pd.positionName);
                    if (!pos || isCustomCoverPosition(pos)) continue;
                    const needed = pd.bandSlots[code] || 0;
                    if (needed <= 0) continue;
                    const posPool = params.positionGroups[pos.positionName] || [];
                    let have = countAssigned(params.assignments, day.dateStr, pd.positionName, code);
                    while (have < needed) {
                        if (trySwapBandOnSamePosition(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            progress = true;
                            continue;
                        }
                        if (tryMoveSameBandWorkerToGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            progress = true;
                            continue;
                        }
                        if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                            candidatePool: posPool.length > 0 ? posPool : globalPool,
                            ignoreFixedShift: true,
                            ignorePendulum: true,
                            preferRemainingBudget: true,
                        })) {
                            have++;
                            progress = true;
                            continue;
                        }
                        if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                            candidatePool: globalPool,
                            ignoreFixedShift: true,
                            ignorePendulum: true,
                            preferRemainingBudget: true,
                        })) {
                            have++;
                            progress = true;
                            continue;
                        }
                        if (mayConvertFrancoToWork(params.ctx) && tryPromoteCycleWorkFrancoToGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            progress = true;
                            continue;
                        }
                        if (tryPromoteRetToSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            progress = true;
                            continue;
                        }
                        if (mayFrancoRescueForGap(params.ctx) && tryFillSlotFromFrancoRescue(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                            ignorePendulum: true,
                            allowSlaClose: true,
                        })) {
                            have++;
                            progress = true;
                            continue;
                        }
                        if (mayConvertFrancoToWork(params.ctx) && mayUseFrancoWorkedRescue(params.ctx) && tryFillSlotFromFrancoRescue(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                            ignorePendulum: true,
                            allowSlaClose: true,
                        })) {
                            have++;
                            progress = true;
                            continue;
                        }
                        if (tryReassignWorkerToGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            progress = true;
                            continue;
                        }
                        if (tryCrossPositionTwoWorkerSwapForGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            progress = true;
                            continue;
                        }
                        if (mayConvertFrancoToWork(params.ctx) && bruteForceFrancoToGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            progress = true;
                            continue;
                        }
                        break;
                    }
                }
            }
            for (const pd of day.positions) {
                const pos = ctx.positions.find(p => p.positionName === pd.positionName);
                if (!pos || isCustomCoverPosition(pos)) continue;
                if (tryClosePositionDayWith12hAlternate(params, pos, pd, day.dateStr, day.dayLetter, inCurrent)) {
                    progress = true;
                }
            }
        }
        recomputeUncoveredStats(params, dayDemands);
        if (!progress || (params.stats.uncoveredSlots ?? 0) <= 0) break;
    }
}

const APRETAR_INVALID_BANDS = new Set(['M', 'T', 'N']);

function revertBillableCell(params: DemandDrivenFillParams, a: V2Assignment): void {
    const hrs = Number(a.hours) || 0;
    if (hrs <= 0) return;
    const st = params.runtime[a.empId];
    if (!st) return;
    const wkKey = isoWeekKeyFromDateStr(a.dateStr);
    const dayNum = parseInt(a.dateStr.split('-')[2], 10);
    const inCurrent = dayNum <= params.cutoffDay;
    st.weekHours[wkKey] = Math.max(0, (st.weekHours[wkKey] || 0) - hrs);
    if (inCurrent) {
        st.cycleCurrentUsed = Math.max(0, st.cycleCurrentUsed - hrs);
        params.stats.employeeCycleHours.current[a.empId] = st.cycleCurrentUsed;
    } else {
        st.cycleNextUsed = Math.max(0, st.cycleNextUsed - hrs);
        params.stats.employeeCycleHours.next[a.empId] = st.cycleNextUsed;
    }
    st.monthHours = Math.max(0, st.monthHours - hrs);
    params.stats.employeeMonthlyHours[a.empId] = st.monthHours;
    params.stats.totalBillableHours = Math.max(0, (params.stats.totalBillableHours || 0) - hrs);
}

/**
 * AUTO base (sin ajustar crono / apretar): RET solo retDesignateSet.
 * Evita RET masivo por reglas opcionales mal aplicadas.
 */
export function stripUnauthorizedRetAssignments(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    retDesignateSet: Set<string>,
): void {
    for (const a of assignments) {
        if (String(a.code || '').toUpperCase() !== 'RET') continue;
        if (retDesignateSet.has(a.empId)) continue;
        if (ctx.rotateShifts === false
            && (ctx.ajustarCrono === true || (ctx.contingencyApretarDays?.length ?? 0) > 0)) continue;
        if (ctx.ajustarCrono === true && ctx.rotateShifts !== false) continue;
        if (isApretarScheduleActive(ctx, a.dateStr)) continue;
        a.code = 'F';
        a.name = 'Franco';
        a.hours = 0;
        a.startTime = '00:00';
        a.isFranco = true;
        a.isReten = false;
        a.positionName = '';
    }
}

/** Días Modo 12: cierra D12+N12; pool RET solo en contingencia manual. */
export function finalizeApretarDayAssignments(
    params: DemandDrivenFillParams,
    dayDemands: ObjectiveDayDemand[],
): void {
    const { ctx, cycleWorkDays, assignments, runtime, isCustomCoverPosition } = params;
    const modo12Days = getModo12Days(ctx);
    if (!modo12Days.length || ctx.rotateShifts === false) return;

    for (const day of dayDemands) {
        if (!isModo12Day(day.dateStr, ctx)) continue;
        const isContingency = isContingencyApretarDay(day.dateStr, ctx);

        if (isContingency) {
            for (const a of assignments) {
                if (a.dateStr !== day.dateStr) continue;
                const code = normBand(a.code);
                if (!APRETAR_INVALID_BANDS.has(code)) continue;
                const pos = ctx.positions.find(p => p.positionName === a.positionName);
                if (!pos || isCustomCoverPosition(pos)) continue;

                revertBillableCell(params, a);
                a.positionName = '';
                a.code = 'RET';
                a.name = 'Retén';
                a.hours = 0;
                a.startTime = '00:00';
                a.isFranco = false;
                a.isReten = true;
                delete a.endTime;
            }
        }

        const dayNum = parseInt(day.dateStr.split('-')[2], 10);
        const inCurrent = dayNum <= params.cutoffDay;
        for (const code of ['D12', 'N12'] as const) {
            for (const pd of day.positions) {
                const pos = ctx.positions.find(p => p.positionName === pd.positionName);
                if (!pos || isCustomCoverPosition(pos)) continue;
                const needed = pd.bandSlots[code] || 0;
                let have = countAssigned(assignments, day.dateStr, pd.positionName, code);
                while (have < needed) {
                    if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                        candidatePool: global24hsEmployeePool(params),
                        ignoreFixedShift: true,
                        preferRemainingBudget: true,
                    })) {
                        have++;
                    } else {
                        break;
                    }
                }
            }
        }

        if (!isContingency) continue;

        for (const empId of global24hsEmployeePool(params)) {
            if (runtime[empId].assignedDays.has(day.dateStr)) continue;
            if (!cycleWorkDays[empId]?.has(day.dateStr)) continue;
            if (ctx.absences[empId]?.has(day.dateStr)) continue;
            assignments.push({
                empId,
                dateStr: day.dateStr,
                positionName: '',
                code: 'RET',
                name: 'Retén',
                hours: 0,
                startTime: '00:00',
                isFranco: false,
                isReten: true,
            });
            runtime[empId].assignedDays.add(day.dateStr);
        }

        const poolSet = new Set(global24hsEmployeePool(params));
        for (const a of assignments) {
            if (a.dateStr !== day.dateStr) continue;
            if (normBand(a.code) !== 'F' || !a.isFranco) continue;
            if (!poolSet.has(a.empId)) continue;
            if (!cycleWorkDays[a.empId]?.has(day.dateStr)) continue;
            if (ctx.absences[a.empId]?.has(day.dateStr)) continue;
            a.code = 'RET';
            a.name = 'Retén';
            a.isFranco = false;
            a.isReten = true;
        }
    }
    recomputeUncoveredStats(params, dayDemands);
}

/** Sin celdas vacías: F en descanso de ciclo; en laborable solo banda esperada del péndulo. */
export function ensureRotativeCellsAssigned(
    params: DemandDrivenFillParams,
): void {
    const { ctx, cycleWorkDays, assignments, runtime, positionGroups, empAssignedTo, expectedShiftForDay } = params;
    if (ctx.rotateShifts === false) return;

    for (const emp of ctx.employees) {
        const st = runtime[emp.id];
        const posName = empAssignedTo?.[emp.id] || defaultPosFromAssignments(emp.id, assignments);
        const pos = posName ? ctx.positions.find(p => p.positionName === posName) : null;

        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            if (st.assignedDays.has(dateStr)) continue;

            const isWork = cycleWorkDays[emp.id]?.has(dateStr);
            if (!isWork) {
                assignments.push({
                    empId: emp.id,
                    dateStr,
                    positionName: '',
                    code: 'F',
                    name: 'Franco',
                    hours: 0,
                    startTime: '00:00',
                    isFranco: true,
                });
                st.assignedDays.add(dateStr);
                continue;
            }

            if (!pos || params.isCustomCoverPosition(pos) || !expectedShiftForDay) continue;
            const dayLetter = ctx.getDayLetter(dateStr);
            if (!positionIsActiveOn(pos, dayLetter)) continue;
            const exp = expectedShiftForDay(emp.id, dateStr, pos.positionName);
            if (!exp) continue;
            const inCurrent = day.getDate() <= params.cutoffDay;
            if (isModo12Day(dateStr, ctx)) {
                const bc = normBand(exp);
                const slotCode = bc === 'N' || bc === 'N12' ? 'N12' : bc === 'T' ? null : 'D12';
                if (slotCode) {
                    tryFillOneSlot(params, pos, dateStr, dayLetter, slotCode, inCurrent, {
                        candidatePool: [emp.id],
                        ignoreFixedShift: true,
                    });
                }
                if (!st.assignedDays.has(dateStr)) {
                    if (isContingencyApretarDay(dateStr, ctx)) {
                        assignments.push({
                            empId: emp.id,
                            dateStr,
                            positionName: '',
                            code: 'RET',
                            name: 'Retén',
                            hours: 0,
                            startTime: '00:00',
                            isFranco: false,
                            isReten: true,
                        });
                        st.assignedDays.add(dateStr);
                    }
                }
                continue;
            }
            tryFillOneSlot(params, pos, dateStr, dayLetter, exp, inCurrent, {
                candidatePool: [emp.id],
                ignoreFixedShift: true,
            });
        }
    }
}

function defaultPosFromAssignments(empId: string, assignments: DemandDrivenFillParams['assignments']): string {
    const a = assignments.find(x => x.empId === empId && x.positionName && (x.hours ?? 0) > 0);
    return a?.positionName || '';
}

/** Reparte dotación equitativamente entre puestos 24hs qty=1 (ej. 4 puestos × 4 guardias). */
export function rebalanceEqual24hsPositionGroups(
    positions: V2PositionDef[],
    positionGroups: Record<string, string[]>,
    empAssignedTo: Record<string, string | null>,
    globalStaggerByEmp?: Record<string, number>,
): void {
    const rotNames = positions
        .filter(p => {
            const cov = String(p.coverageType || '').toLowerCase();
            return (cov === '24hs' || cov === '24' || cov === '24h')
                && Math.max(1, Number(p.qty) || 1) === 1;
        })
        .map(p => p.positionName);
    if (rotNames.length < 2) return;

    const pool: string[] = [];
    for (const name of rotNames) {
        for (const id of positionGroups[name] || []) {
            if (!pool.includes(id)) pool.push(id);
        }
    }
    if (pool.length === 0) return;

    const perPos = Math.max(1, Math.floor(pool.length / rotNames.length));
    rotNames.forEach(n => { positionGroups[n] = []; });
    pool.forEach((empId, idx) => {
        const posName = rotNames[idx % rotNames.length];
        positionGroups[posName].push(empId);
        empAssignedTo[empId] = posName;
        if (globalStaggerByEmp) {
            globalStaggerByEmp[empId] = Math.floor(idx / rotNames.length);
        }
    });

    // Si sobran por división entera, completar puestos con menos gente
    let cursor = 0;
    for (const name of rotNames) {
        while (positionGroups[name].length < perPos && cursor < pool.length) {
            const empId = pool[cursor++];
            if (!positionGroups[name].includes(empId)) {
                positionGroups[name].push(empId);
                empAssignedTo[empId] = name;
            }
        }
    }
}

function recordUncovered(
    stats: V2GenerateStats,
    dateStr: string,
    positionName: string,
    code: string,
    missing: number,
) {
    stats.uncoveredSlots = (stats.uncoveredSlots || 0) + missing;
    if (!stats.uncoveredSlotsByDay) stats.uncoveredSlotsByDay = {};
    if (!stats.uncoveredSlotsByDay[dateStr]) stats.uncoveredSlotsByDay[dateStr] = [];
    stats.uncoveredSlotsByDay[dateStr].push({ positionName, code, missing });
}

/** Paso 3: llenar huecos SLA día × puesto × banda. */
export function fillScheduleFromDemand(params: DemandDrivenFillParams): ObjectiveDayDemand[] {
    const { ctx, isCustomCoverPosition } = params;

    const days = ctx.daysInMonth.map(d => {
        const dateStr = ctx.getDateKey(d);
        return { dateStr, dayLetter: ctx.getDayLetter(dateStr) };
    });

    const dayDemands = buildObjectiveCoverageDemand(
        ctx.positions,
        days,
        ctx.autoCycles,
        (pos, letter) => positionIsActiveOn(pos, letter),
        getModo12Days(ctx),
    );

    if (ctx.rotateShifts !== false && params.expectedShiftForDay) {
        fillScheduleFromPendulum(params, dayDemands, isCustomCoverPosition);
    } else {
        fillScheduleDemandDriven(params, dayDemands, isCustomCoverPosition);
    }
    recomputeUncoveredStats(params, dayDemands);
    return dayDemands;
}

/** Rotativo: empareja guardias a su banda del bloque CCT (6+2) antes de rescate SLA. */
function fillScheduleFromPendulum(
    params: DemandDrivenFillParams,
    dayDemands: ObjectiveDayDemand[],
    isCustomCoverPosition: (pos: V2PositionDef) => boolean,
): void {
    const { ctx, expectedShiftForDay, passesAgreementRest, shiftHoursH } = params;
    if (!expectedShiftForDay) {
        fillScheduleDemandDriven(params, dayDemands, isCustomCoverPosition);
        return;
    }

    const refPos = ctx.positions.find(p => !isCustomCoverPosition(p));
    const refPosName = refPos?.positionName || '';
    const sortedDays = [...dayDemands].sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    for (const day of sortedDays) {
        if (day.totalPaxUnits <= 0) continue;
        const dayNum = parseInt(day.dateStr.split('-')[2], 10);
        const inCurrent = dayNum <= params.cutoffDay;

        const rotPositions = day.positions.filter(pd => {
            const pos = ctx.positions.find(p => p.positionName === pd.positionName);
            return pos && !isCustomCoverPosition(pos);
        });

        const bandOrder = ['M', 'T', 'N', 'D12', 'N12'].filter(code =>
            rotPositions.some(pd => (pd.bandSlots[code] || 0) > 0),
        );

        type SlotRef = { pos: V2PositionDef; code: string; filled: boolean };
        const openSlots: SlotRef[] = [];
        for (const pd of rotPositions) {
            const pos = ctx.positions.find(p => p.positionName === pd.positionName)!;
            for (const code of bandOrder) {
                const needed = pd.bandSlots[code] || 0;
                for (let n = 0; n < needed; n++) {
                    openSlots.push({ pos, code, filled: false });
                }
            }
        }

        const globalPool = global24hsEmployeePool(params);
        const workersByBand: Record<string, string[]> = {};
        for (const code of bandOrder) workersByBand[code] = [];
        const apretarDay = isModo12Day(day.dateStr, ctx);

        for (const empId of globalPool) {
            if (params.runtime[empId].assignedDays.has(day.dateStr)) continue;
            if (!params.cycleWorkDays[empId]?.has(day.dateStr)) continue;
            if (ctx.absences[empId]?.has(day.dateStr)) continue;
            const exp = expectedShiftForDay(empId, day.dateStr, refPosName);
            if (!exp) continue;
            const bc = normBand(exp);
            if (apretarDay) {
                if (bc === 'M' || bc === 'D12') {
                    const slotCode = 'D12';
                    const sh = shiftDefForCode(refPos!, day.dayLetter, slotCode, ctx.autoCycles, shiftHoursH);
                    const sStart = sh.startTime || DEFAULT_START[slotCode] || '07:00';
                    if (!canAssignBand(params, empId, day.dateStr, slotCode, sStart, shiftHoursH(sh))) continue;
                    if (!workersByBand[slotCode]) workersByBand[slotCode] = [];
                    workersByBand[slotCode].push(empId);
                } else if (bc === 'N' || bc === 'N12') {
                    const slotCode = 'N12';
                    const sh = shiftDefForCode(refPos!, day.dayLetter, slotCode, ctx.autoCycles, shiftHoursH);
                    const sStart = sh.startTime || DEFAULT_START[slotCode] || '19:00';
                    if (!canAssignBand(params, empId, day.dateStr, slotCode, sStart, shiftHoursH(sh))) continue;
                    if (!workersByBand[slotCode]) workersByBand[slotCode] = [];
                    workersByBand[slotCode].push(empId);
                }
                continue;
            }
            if (!workersByBand[bc]) continue;
            const sh = shiftDefForCode(refPos!, day.dayLetter, bc, ctx.autoCycles, shiftHoursH);
            const sHrs = shiftHoursH(sh);
            const sStart = sh.startTime || DEFAULT_START[bc] || '07:00';
            if (!canAssignBand(params, empId, day.dateStr, bc, sStart, sHrs)) continue;
            workersByBand[bc].push(empId);
        }

        for (const code of bandOrder) {
            for (const pd of rotPositions) {
                const pos = ctx.positions.find(p => p.positionName === pd.positionName)!;
                const needed = pd.bandSlots[code] || 0;
                const posPool = params.positionGroups[pos.positionName] || [];
                const pending = sortCandidates(
                    (workersByBand[code] || []).filter(id => posPool.includes(id)),
                    params,
                    code,
                    inCurrent,
                );
                for (let n = 0; n < needed; n++) {
                    let filled = false;
                    for (const empId of pending) {
                        if (params.runtime[empId].assignedDays.has(day.dateStr)) continue;
                        if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                            candidatePool: [empId],
                            ignoreFixedShift: true,
                        })) {
                            filled = true;
                            break;
                        }
                    }
                    if (!filled) {
                        for (const slot of openSlots) {
                            if (slot.filled || slot.pos.positionName !== pos.positionName || slot.code !== code) continue;
                            for (const empId of pending) {
                                if (params.runtime[empId].assignedDays.has(day.dateStr)) continue;
                                if (tryFillOneSlot(params, slot.pos, day.dateStr, day.dayLetter, code, inCurrent, {
                                    candidatePool: [empId],
                                    ignoreFixedShift: true,
                                })) {
                                    slot.filled = true;
                                    filled = true;
                                    break;
                                }
                            }
                            if (filled) break;
                        }
                    }
                }
            }
        }

        for (const code of bandOrder) {
            for (const slot of openSlots.filter(s => !s.filled && s.code === code)) {
                const posPool = params.positionGroups[slot.pos.positionName] || [];
                // Preferir empleados de la banda correcta del posPool; si no hay disponibles,
                // usar cualquier empleado disponible del posPool (el péndulo de 3 bandas crea
                // desequilibrios donde rotationSlot=1 nunca cubre M).
                const bandFiltered = posPool.length > 0
                    ? (workersByBand[code] || []).filter(id =>
                        posPool.includes(id) && !params.runtime[id].assignedDays.has(day.dateStr))
                    : (workersByBand[code] || []).filter(id =>
                        !params.runtime[id].assignedDays.has(day.dateStr));
                const poolToUse = bandFiltered.length > 0
                    ? bandFiltered
                    : posPool.filter(id =>
                        !params.runtime[id].assignedDays.has(day.dateStr) &&
                        params.cycleWorkDays[id]?.has(day.dateStr) &&
                        !ctx.absences[id]?.has(day.dateStr));
                const pending = sortCandidates(poolToUse, params, code, inCurrent);
                for (const empId of pending) {
                    if (params.runtime[empId].assignedDays.has(day.dateStr)) continue;
                    if (tryFillOneSlot(params, slot.pos, day.dateStr, day.dayLetter, code, inCurrent, {
                        candidatePool: [empId],
                        ignoreFixedShift: true,
                    })) {
                        slot.filled = true;
                        break;
                    }
                }
            }
        }

        for (const slot of openSlots.filter(s => !s.filled).sort((a, b) => {
            const pri = (c: string) => (c === 'M' ? 0 : c === 'T' ? 1 : c === 'N' ? 2 : 3);
            return pri(a.code) - pri(b.code);
        })) {
            const slotPosPool = params.positionGroups[slot.pos.positionName] || [];
            // Rescue phase: preferir empleados del posPool; caer a globalPool solo si el pool está agotado
            const rescueSource = slotPosPool.length > 0 ? slotPosPool : globalPool;
            const phasePool = rescueSource.filter(empId => {
                if (params.runtime[empId].assignedDays.has(day.dateStr)) return false;
                if (!params.cycleWorkDays[empId]?.has(day.dateStr)) return false;
                if (ctx.absences[empId]?.has(day.dateStr)) return false;
                const exp = expectedShiftForDay(empId, day.dateStr, slot.pos.positionName);
                if (apretarDay) return pendulumMatchesApretarSlot(exp, slot.code);
                return bandMatchesExpected(exp, slot.code);
            });
            const sorted = sortCandidates(phasePool, params, slot.code, inCurrent, { preferRemainingBudget: true });
            for (const empId of sorted) {
                const sh = shiftDefForCode(slot.pos, day.dayLetter, slot.code, ctx.autoCycles, shiftHoursH);
                const sHrs = shiftHoursH(sh);
                const sStart = sh.startTime || DEFAULT_START[slot.code] || '07:00';
                if (!canAssignBand(params, empId, day.dateStr, slot.code, sStart, sHrs)) continue;
                if (tryFillOneSlot(params, slot.pos, day.dateStr, day.dayLetter, slot.code, inCurrent, {
                    candidatePool: [empId],
                    ignoreFixedShift: true,
                })) {
                    slot.filled = true;
                    break;
                }
            }
            if (slot.filled) continue;
            // Último recurso: posPool con criterios relajados primero; globalPool solo si posPool agotado
            const ultimoPosPool = slotPosPool.filter(empId =>
                isAvailableForSlot(empId, day.dateStr, slot.code, params, globalPool, {}),
            );
            const rescuePool = ultimoPosPool.length > 0
                ? ultimoPosPool
                : globalPool.filter(empId => isAvailableForSlot(empId, day.dateStr, slot.code, params, globalPool, {}));
            const rescueSorted = sortCandidates(rescuePool, params, slot.code, inCurrent, { preferRemainingBudget: true });
            for (const empId of rescueSorted) {
                const sh = shiftDefForCode(slot.pos, day.dayLetter, slot.code, ctx.autoCycles, shiftHoursH);
                const sHrs = shiftHoursH(sh);
                const sStart = sh.startTime || DEFAULT_START[slot.code] || '07:00';
                if (!canAssignBand(params, empId, day.dateStr, slot.code, sStart, sHrs)) continue;
                if (tryFillOneSlot(params, slot.pos, day.dateStr, day.dayLetter, slot.code, inCurrent, {
                    candidatePool: [empId],
                    ignoreFixedShift: true,
                    ignorePendulum: true,
                })) {
                    slot.filled = true;
                    break;
                }
            }
        }
        ensureMorningBandBeforeEveningOnDay(params, day, rotPositions, inCurrent, isCustomCoverPosition);
    }
}

/** Evita T/N huérfanos: si hay tarde/noche sin mañana en el puesto, prioriza M. */
function ensureMorningBandBeforeEveningOnDay(
    params: DemandDrivenFillParams,
    day: ObjectiveDayDemand,
    rotPositions: ObjectiveDayDemand['positions'],
    inCurrent: boolean,
    isCustomCoverPosition: (pos: V2PositionDef) => boolean,
): void {
    if (isModo12Day(day.dateStr, params.ctx)) return;

    for (const pd of rotPositions) {
        const pos = params.ctx.positions.find(p => p.positionName === pd.positionName);
        if (!pos || isCustomCoverPosition(pos)) continue;
        const qty = Math.max(1, Number(pos.qty) || 1);
        const mActual = countAssigned(params.assignments, day.dateStr, pd.positionName, 'M');
        const eff = effectiveMtnCoverage(params.assignments, day.dateStr, pd.positionName, qty);
        if (mActual >= qty || (eff.T < qty && eff.N < qty)) continue;

        const mNeed = (pd.bandSlots.M || 0);
        if (mNeed <= 0 || eff.M >= mNeed) continue;

        if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, 'M', inCurrent, {
            candidatePool: params.positionGroups[pos.positionName] || global24hsEmployeePool(params),
            ignoreFixedShift: true,
            ignorePendulum: true,
            preferRemainingBudget: true,
        })) continue;

        tryCrossPositionTwoWorkerSwapForGap(params, pos, day.dateStr, day.dayLetter, 'M', inCurrent);
    }
}

function fillScheduleDemandDriven(
    params: DemandDrivenFillParams,
    dayDemands: ObjectiveDayDemand[],
    isCustomCoverPosition: (pos: V2PositionDef) => boolean,
): void {
    const { ctx } = params;
    const sortedDays = [...dayDemands].sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    for (const day of sortedDays) {
        if (day.totalPaxUnits <= 0) continue;
        const dayNum = parseInt(day.dateStr.split('-')[2], 10);
        const inCurrent = dayNum <= params.cutoffDay;

        const rotPositions = day.positions.filter(pd => {
            const pos = ctx.positions.find(p => p.positionName === pd.positionName);
            return pos && !isCustomCoverPosition(pos);
        });

        const bandOrder = ['M', 'T', 'N', 'D12', 'N12'].filter(code =>
            rotPositions.some(pd => (pd.bandSlots[code] || 0) > 0),
        );

        for (const code of bandOrder) {
            for (const posDemand of rotPositions) {
                const needed = posDemand.bandSlots[code] || 0;
                if (needed <= 0) continue;
                const pos = ctx.positions.find(p => p.positionName === posDemand.positionName)!;
                let filled = 0;
                while (filled < needed) {
                    const rotate = ctx.rotateShifts !== false && params.expectedShiftForDay;
                    if (rotate) {
                        const globalPool = global24hsEmployeePool(params);
                        const pendulumPool = globalPool.filter(empId =>
                            isAvailableForSlot(empId, day.dateStr, code, params, globalPool, {})
                            && bandMatchesExpected(
                                params.expectedShiftForDay!(empId, day.dateStr, pos.positionName),
                                code,
                            ),
                        );
                        if (pendulumPool.length > 0 && tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                            candidatePool: pendulumPool,
                            ignoreFixedShift: true,
                        })) {
                            filled++;
                            continue;
                        }
                        if (rotate && tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                            candidatePool: global24hsEmployeePool(params),
                            ignoreFixedShift: true,
                            ignorePendulum: true,
                            preferRemainingBudget: true,
                        })) {
                            filled++;
                            continue;
                        }
                    }
                    if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                        filled++;
                    } else {
                        break;
                    }
                }
            }
        }

        for (const code of bandOrder) {
            for (const posDemand of rotPositions) {
                const needed = posDemand.bandSlots[code] || 0;
                const pos = ctx.positions.find(p => p.positionName === posDemand.positionName)!;
                let filled = countAssigned(params.assignments, day.dateStr, pos.positionName, code);
                while (filled < needed) {
                    if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                        filled++;
                    } else if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                        candidatePool: global24hsEmployeePool(params),
                        ignoreFixedShift: true,
                    })) {
                        filled++;
                    } else break;
                }
            }
        }

        for (const posDemand of rotPositions) {
            const pos = ctx.positions.find(p => p.positionName === posDemand.positionName)!;
            if (!positionDayMtnGap(params.assignments, day.dateStr, posDemand, Math.max(1, Number(pos.qty) || 1))) continue;
            tryClosePositionDayWith12hAlternate(params, pos, posDemand, day.dateStr, day.dayLetter, inCurrent);
        }
    }
}

/**
 * Motor demand-driven (SLA slot × día × banda): solo rotativo ON.
 * Bandas fijas (rotateShifts=false) usan el loop clásico día×puesto×banda en autoScheduleEngineV2.
 */
export function shouldUseDemandDrivenScheduling(ctx: V2EngineContext): boolean {
    if (ctx.demandDriven === false) return false;
    if (ctx.rotateShifts === false) return false;
    const has24 = ctx.positions.some(p => {
        const cov = String(p.coverageType || '').toLowerCase();
        return cov === '24hs' || cov === '24' || cov === '24h';
    });
    return has24;
}

/** Intercambia turno/puesto entre dos filas del mismo día sin cambiar cobertura por banda. */
function swapWorkAssignmentFields(a: V2Assignment, b: V2Assignment): void {
    const tmp = {
        positionName: a.positionName,
        code: a.code,
        name: a.name,
        hours: a.hours,
        startTime: a.startTime,
        endTime: a.endTime,
    };
    a.positionName = b.positionName;
    a.code = b.code;
    a.name = b.name;
    a.hours = b.hours;
    a.startTime = b.startTime;
    a.endTime = b.endTime;
    b.positionName = tmp.positionName;
    b.code = tmp.code;
    b.name = tmp.name;
    b.hours = tmp.hours;
    b.startTime = tmp.startTime;
    b.endTime = tmp.endTime;
}

/** Tras demand-driven: alinear filas al péndulo CCT sin romper slots SLA del día. */
export function alignAssignmentsToPendulum(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    expectedShiftForDay: (empId: string, dateStr: string, posName: string) => string | null,
    isCustomCoverPosition: (pos: V2PositionDef) => boolean,
    passesAgreementRest?: (empId: string, dateStr: string, code: string, start: string | undefined, hrs: number) => boolean,
): void {
    if (ctx.rotateShifts === false) return;

    const matches = (empId: string, dateStr: string, posName: string, code: string) => {
        const exp = expectedShiftForDay(empId, dateStr, posName);
        if (!exp) return true;
        return bandMatchesExpected(exp, code);
    };

    const workIndicesForDay = (dateStr: string): number[] => {
        const idx: number[] = [];
        for (let i = 0; i < assignments.length; i++) {
            const a = assignments[i];
            if (a.dateStr !== dateStr || (a.hours ?? 0) <= 0 || a.isFranco) continue;
            const pos = ctx.positions.find(p => p.positionName === a.positionName);
            if (!pos || isCustomCoverPosition(pos)) continue;
            idx.push(i);
        }
        return idx;
    };

    const prevWorkCode = (empId: string, dateStr: string): string | null => {
        const di = ctx.daysInMonth.findIndex(d => ctx.getDateKey(d) === dateStr);
        for (let j = di - 1; j >= 0; j--) {
            const ds = ctx.getDateKey(ctx.daysInMonth[j]);
            const a = assignments.find(x => x.empId === empId && x.dateStr === ds);
            if (!a) continue;
            if ((a.hours ?? 0) <= 0 || a.isFranco) return null;
            return normBand(a.code);
        }
        return null;
    };

    const rowScore = (empId: string, dateStr: string, posName: string, code: string): number => {
        let s = matches(empId, dateStr, posName, code) ? 3 : 0;
        const prev = prevWorkCode(empId, dateStr);
        if (prev && prev === normBand(code)) s += 2;
        return s;
    };

    const swapPreservesRest = (ai: V2Assignment, aj: V2Assignment, dateStr: string): boolean => {
        if (!passesAgreementRest) return true;
        const aiHrs = Number(ai.hours) || 8;
        const ajHrs = Number(aj.hours) || 8;
        return passesAgreementRest(ai.empId, dateStr, String(ai.code), ai.startTime, aiHrs)
            && passesAgreementRest(aj.empId, dateStr, String(aj.code), aj.startTime, ajHrs);
    };

    for (let pass = 0; pass < 24; pass++) {
        let improved = false;
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            if (isModo12Day(dateStr, ctx)) continue;
            const workIdx = workIndicesForDay(dateStr);
            for (let i = 0; i < workIdx.length; i++) {
                for (let j = i + 1; j < workIdx.length; j++) {
                    const ai = assignments[workIdx[i]];
                    const aj = assignments[workIdx[j]];
                    const before = rowScore(ai.empId, dateStr, ai.positionName, ai.code)
                        + rowScore(aj.empId, dateStr, aj.positionName, aj.code);
                    swapWorkAssignmentFields(ai, aj);
                    const after = rowScore(ai.empId, dateStr, ai.positionName, ai.code)
                        + rowScore(aj.empId, dateStr, aj.positionName, aj.code);
                    if (after > before && swapPreservesRest(ai, aj, dateStr)) {
                        improved = true;
                    } else {
                        swapWorkAssignmentFields(ai, aj);
                    }
                }
            }
        }
        if (!improved) break;
    }
}

/** Saltos de banda dentro de una racha laboral (sin franco intermedio). */
export function countWorkStreakBandJumps(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    empId: string,
): number {
    let jumps = 0;
    let streakCode = '';
    for (const day of ctx.daysInMonth) {
        const dateStr = ctx.getDateKey(day);
        const a = assignments.find(x =>
            x.empId === empId && x.dateStr === dateStr && (x.hours ?? 0) > 0,
        );
        const code = a ? normBand(a.code) : 'F';
        if (code === 'F') {
            streakCode = '';
            continue;
        }
        if (!streakCode) {
            streakCode = code;
        } else if (code !== streakCode) {
            jumps++;
            streakCode = code;
        }
    }
    return jumps;
}

function isoWeekKeyFromDateStr(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const weekNum = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${t.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

const STREAK_BREAK_FOR_NM = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);

function walkPrevWorkBand(assignments: V2Assignment[], empId: string, fromDateStr: string): string | null {
    let d = addDaysStr(fromDateStr, -1);
    for (let i = 0; i < 40; i++) {
        const a = assignments.find(x => x.empId === empId && x.dateStr === d);
        if (!a) return null;
        const c = String(a.code || '').toUpperCase();
        if (STREAK_BREAK_FOR_NM.has(c) || a.isFranco) return null;
        if ((a.hours ?? 0) > 0) return c;
        d = addDaysStr(d, -1);
    }
    return null;
}

function walkNextWorkBand(assignments: V2Assignment[], empId: string, fromDateStr: string): string | null {
    let d = fromDateStr;
    for (let i = 0; i < 40; i++) {
        const a = assignments.find(x => x.empId === empId && x.dateStr === d);
        if (!a) return null;
        const c = String(a.code || '').toUpperCase();
        if (STREAK_BREAK_FOR_NM.has(c) || a.isFranco) return null;
        if ((a.hours ?? 0) > 0) return c;
        d = addDaysStr(d, 1);
    }
    return null;
}

function francoProtectsAfterNightBlock(
    assignments: V2Assignment[],
    empId: string,
    francoDateStr: string,
): boolean {
    const prev = walkPrevWorkBand(assignments, empId, francoDateStr);
    const next = walkNextWorkBand(assignments, empId, addDaysStr(francoDateStr, 1));
    return forbiddenNightToNonNightWithoutBreak(prev || '', next || '');
}

/** Transiciones N/N12 → T/M/D12… en días laborales consecutivos (sin F/FF/FP/FT entre medias). */
export function countForbiddenNightToNonNightTransitions(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
): number {
    let count = 0;
    for (const emp of ctx.employees) {
        for (let di = 1; di < ctx.daysInMonth.length; di++) {
            const prevDs = ctx.getDateKey(ctx.daysInMonth[di - 1]);
            const curDs = ctx.getDateKey(ctx.daysInMonth[di]);
            const prevA = assignments.find(x => x.empId === emp.id && x.dateStr === prevDs);
            const curA = assignments.find(x => x.empId === emp.id && x.dateStr === curDs);
            const prevCode = prevA && (prevA.hours ?? 0) > 0 && !prevA.isFranco
                ? String(prevA.code).toUpperCase() : '';
            const curCode = curA && (curA.hours ?? 0) > 0 && !curA.isFranco
                ? String(curA.code).toUpperCase() : '';
            if (forbiddenNightToNonNightWithoutBreak(prevCode, curCode)) count++;
        }
    }
    return count;
}

/** @deprecated Usar countForbiddenNightToNonNightTransitions */
export const countForbiddenNightToMorningTransitions = countForbiddenNightToNonNightTransitions;

/**
 * Corrige N→T/M/… sin franco (p. ej. tras swap del péndulo): intenta intercambiar el
 * turno conflictivo con otro guardia del mismo día que sí cumpla descanso.
 */
export function repairForbiddenAfterNightTransitions(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    passesAgreementRest: (empId: string, dateStr: string, code: string, start: string | undefined, hrs: number) => boolean,
): number {
    const NIGHT = new Set(['N', 'N12']);
    let fixed = 0;

    for (const emp of ctx.employees) {
        for (let di = 1; di < ctx.daysInMonth.length; di++) {
            const prevDs = ctx.getDateKey(ctx.daysInMonth[di - 1]);
            const curDs = ctx.getDateKey(ctx.daysInMonth[di]);
            const curA = assignments.find(x =>
                x.empId === emp.id && x.dateStr === curDs && (x.hours ?? 0) > 0 && !x.isFranco,
            );
            if (!curA) continue;
            const prevA = assignments.find(x =>
                x.empId === emp.id && x.dateStr === prevDs && (x.hours ?? 0) > 0 && !x.isFranco,
            );
            if (!prevA) continue;
            const pc = String(prevA.code).toUpperCase();
            const nc = String(curA.code).toUpperCase();
            if (!NIGHT.has(pc) || NIGHT.has(nc)) continue;

            const dayPeers = assignments.filter(x =>
                x.dateStr === curDs &&
                (x.hours ?? 0) > 0 &&
                !x.isFranco &&
                x.positionName &&
                x.empId !== emp.id,
            );

            let repaired = false;
            for (const peer of dayPeers) {
                swapWorkAssignmentFields(curA, peer);
                const curHrs = Number(curA.hours) || 8;
                const peerHrs = Number(peer.hours) || 8;
                const ok = passesAgreementRest(curA.empId, curDs, String(curA.code), curA.startTime, curHrs)
                    && passesAgreementRest(peer.empId, curDs, String(peer.code), peer.startTime, peerHrs);
                if (ok) {
                    fixed++;
                    repaired = true;
                    break;
                }
                swapWorkAssignmentFields(curA, peer);
            }
            if (!repaired) {
                continue;
            }
        }
    }
    return fixed;
}

/**
 * Rotativo ON: restaurar F en días de descanso del ciclo (expected=null).
 * Convierte RET→F para que se vean bloques 6+2 limpios, no tablero de retén.
 */
export function restoreRotativeCycleFrancos(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    expectedShiftForDay: (empId: string, dateStr: string, posName: string) => string | null,
    defaultPosByEmp: Record<string, string | null | undefined>,
    cycleWorkDays?: Record<string, Set<string>>,
): void {
    if (ctx.rotateShifts === false) return;
    for (const a of assignments) {
        if (String(a.code || '').toUpperCase() !== 'RET') continue;
        if (isContingencyApretarDay(a.dateStr, ctx)) continue;
        // RET en día Modo12: asignado intencionalmente (turno T absorbido por D12/N12).
        if (isModo12Day(a.dateStr, ctx)) continue;
        // RET en día laborable del ciclo: el guardia está disponible pero sin slot → mantener RET.
        // Convertirlo a F rompería el bloque 6+2 y generaría francos dispersos o consecutivos.
        if (cycleWorkDays?.[a.empId]?.has(a.dateStr)) continue;
        const posName = defaultPosByEmp[a.empId] || a.positionName || ctx.positions[0]?.positionName || '';
        const exp = expectedShiftForDay(a.empId, a.dateStr, posName);
        if (exp) continue;
        a.code = 'F';
        a.name = 'Franco';
        a.hours = 0;
        a.startTime = '00:00';
        a.isFranco = true;
        a.isReten = false;
        a.positionName = '';
    }
}

/**
 * @deprecated No usar: F es descanso legal del 6+2 (35 h entre turnos), no stand-by RET.
 * RET solo lo asigna el fallback para el guardia sobrante designado (retDesignateSet).
 */
export function convertExtraCycleFrancosToRet(
    assignments: V2Assignment[],
    runtime: DemandDrivenFillParams['runtime'],
    limitedEmpIds: Set<string>,
    rotateShifts?: boolean,
): void {
    if (rotateShifts !== false) return;
    const defaultCap = SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_DEFAULT;
    const limitedCap = SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_LIMITED_POSITION;

    for (const a of assignments) {
        if (String(a.code || '').toUpperCase() !== 'F') continue;
        if (!a.isFranco && (a.hours ?? 0) > 0) continue;
        const st = runtime[a.empId];
        if (!st) continue;
        const wk = isoWeekKeyFromDateStr(a.dateStr);
        const weekBillable = st.weekHours[wk] ?? 0;
        const cap = limitedEmpIds.has(a.empId) ? limitedCap : defaultCap;
        if (weekBillable >= cap - 1e-6) continue;
        if (francoProtectsAfterNightBlock(assignments, a.empId, a.dateStr)) continue;

        a.code = 'RET';
        a.name = 'Retén';
        a.hours = 0;
        a.isFranco = false;
        a.isReten = true;
    }
}
