/**
 * Generación demand-driven: llena slots SLA (M/T/N por puesto/día) antes de francos.
 */

import { buildObjectiveCoverageDemand, type ObjectiveDayDemand } from './objectiveCoverageDemand';
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
import { assignmentBreaksBandTransition, bandMatchesExpected, normBand } from './rotativeBandGuard';

const FRANCO_SET = new Set(['F', 'FF', 'FP', 'FT']);

const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12, EN: 9 };

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
}

interface TryFillOptions {
    candidatePool?: string[];
    ignoreFixedShift?: boolean;
    ignorePendulum?: boolean;
    preferRemainingBudget?: boolean;
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
        if (options?.preferRemainingBudget) {
            const remA = HARD_MAX_HOURS - cctUsed(runtime, a, inCurrent, limitedEmpIds.has(a));
            const remB = HARD_MAX_HOURS - cctUsed(runtime, b, inCurrent, limitedEmpIds.has(b));
            if (remA !== remB) return remB - remA;
        }
        const ha = cctUsed(runtime, a, inCurrent, limitedEmpIds.has(a));
        const hb = cctUsed(runtime, b, inCurrent, limitedEmpIds.has(b));
        if (ha !== hb) return ha - hb;
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

    for (const empId of candidates) {
        if (!authorized?.has(empId) && cctUsed(runtime, empId, inCurrent, limitedEmpIds.has(empId)) + sHrs > HARD_MAX_HOURS) {
            continue;
        }
        const restOk = rotate
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

export function recomputeUncoveredStats(params: DemandDrivenFillParams, dayDemands: ObjectiveDayDemand[]): void {
    const { stats, isCustomCoverPosition, ctx } = params;
    stats.uncoveredSlots = 0;
    stats.uncoveredSlotsByDay = {};
    for (const day of dayDemands) {
        for (const pd of day.positions) {
            const pos = ctx.positions.find(p => p.positionName === pd.positionName);
            if (!pos || isCustomCoverPosition(pos)) continue;
            for (const [code, needed] of Object.entries(pd.bandSlots)) {
                const have = countAssigned(params.assignments, day.dateStr, pd.positionName, code);
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
        const dayNum = parseInt(day.dateStr.split('-')[2], 10);
        const inCurrent = dayNum <= params.cutoffDay;
        const bandOrder = ['M', 'T', 'N', 'D12', 'N12'];
        for (let pass = 0; pass < 6; pass++) {
            const globalPool = pass >= 1 ? global24hsEmployeePool(params) : undefined;
            const ignoreFixed = pass >= 1;
            for (const code of bandOrder) {
                const ignorePendulum = ctx.rotateShifts !== false
                    && (pass >= 4 || (pass === 2 && code === 'M') || (pass === 3 && code === 'N'));
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
                        if ((pass >= 5 || ctx.rotateShifts === false)
                            && tryReassignWorkerToGap(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                            have++;
                            continue;
                        }
                        break;
                    }
                }
            }
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

        for (const empId of globalPool) {
            if (params.runtime[empId].assignedDays.has(day.dateStr)) continue;
            if (!params.cycleWorkDays[empId]?.has(day.dateStr)) continue;
            if (ctx.absences[empId]?.has(day.dateStr)) continue;
            const exp = expectedShiftForDay(empId, day.dateStr, refPosName);
            if (!exp) continue;
            const bc = normBand(exp);
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
            const pending = sortCandidates(workersByBand[code] || [], params, code, inCurrent);
            for (const slot of openSlots.filter(s => !s.filled && s.code === code)) {
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

        for (const slot of openSlots.filter(s => !s.filled)) {
            const phasePool = globalPool.filter(empId => {
                if (params.runtime[empId].assignedDays.has(day.dateStr)) return false;
                if (!params.cycleWorkDays[empId]?.has(day.dateStr)) return false;
                if (ctx.absences[empId]?.has(day.dateStr)) return false;
                const exp = expectedShiftForDay(empId, day.dateStr, slot.pos.positionName);
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
            const rescuePool = globalPool.filter(empId =>
                isAvailableForSlot(empId, day.dateStr, slot.code, params, globalPool, {}),
            );
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
            if (!posDemand.alternateBandSlots || Object.keys(posDemand.alternateBandSlots).length < 2) continue;
            const mtnCodes = Object.keys(posDemand.bandSlots);
            const hasGap = mtnCodes.some(code => {
                const needed = posDemand.bandSlots[code] || 0;
                const have = params.assignments.filter(a =>
                    a.dateStr === day.dateStr &&
                    a.positionName === pos.positionName &&
                    String(a.code).toUpperCase() === code &&
                    a.hours > 0,
                ).length;
                return have < needed;
            });
            if (!hasGap) continue;
            for (const altCode of ['D12', 'N12']) {
                const altNeed = posDemand.alternateBandSlots[altCode] || 0;
                let altFilled = params.assignments.filter(a =>
                    a.dateStr === day.dateStr &&
                    a.positionName === pos.positionName &&
                    String(a.code).toUpperCase() === altCode &&
                    a.hours > 0,
                ).length;
                while (altFilled < altNeed) {
                    if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, altCode, inCurrent)) {
                        altFilled++;
                    } else break;
                }
            }
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
): void {
    if (ctx.rotateShifts === false) return;
    for (const a of assignments) {
        if (String(a.code || '').toUpperCase() !== 'RET') continue;
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
