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

const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12, EN: 9 };
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

interface TryFillOptions {
    candidatePool?: string[];
    ignoreFixedShift?: boolean;
    preferRemainingBudget?: boolean;
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
    } = params;

    const pool = options?.candidatePool ?? (positionGroups[pos.positionName] || []);
    const fixedShift = options?.ignoreFixedShift ? {} : (ctx.defaultShiftByEmp || {});
    const authorized = ctx.authorizedOver200Ids;

    const candidates = pool
        .filter(empId => {
            if (customCoverEmps.has(empId)) return false;
            if (runtime[empId].assignedDays.has(dateStr)) return false;
            if (ctx.absences[empId]?.has(dateStr)) return false;
            if (!cycleWorkDays[empId]?.has(dateStr)) return false;
            const fx = fixedShift[empId];
            if (fx && String(fx).toUpperCase() !== code) return false;
            return true;
        })
        .sort((a, b) => {
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

    const sh = shiftDefForCode(pos, dayLetter, code, ctx.autoCycles, shiftHoursH);
    const sHrs = shiftHoursH(sh);
    const sStart = sh.startTime || DEFAULT_START[code] || '07:00';
    const sEnd = sh.endTime;

    for (const empId of candidates) {
        if (!authorized?.has(empId) && cctUsed(runtime, empId, inCurrent, limitedEmpIds.has(empId)) + sHrs > HARD_MAX_HOURS) {
            continue;
        }
        if (!passesAgreementRest(empId, dateStr, code, sStart, sHrs)) continue;
        writeAssignment(empId, dateStr, pos.positionName, code, sh.name || code, sHrs, sStart, inCurrent, sEnd);
        return true;
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

function recomputeUncoveredStats(params: DemandDrivenFillParams, dayDemands: ObjectiveDayDemand[]): void {
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
        for (let pass = 0; pass < 4; pass++) {
            const pool = pass >= 1 ? global24hsEmployeePool(params) : undefined;
            const ignoreFixed = pass >= 1;
            for (const code of bandOrder) {
                for (const pd of day.positions) {
                    const pos = ctx.positions.find(p => p.positionName === pd.positionName);
                    if (!pos || isCustomCoverPosition(pos)) continue;
                    const needed = pd.bandSlots[code] || 0;
                    if (needed <= 0) continue;
                    let have = countAssigned(params.assignments, day.dateStr, pd.positionName, code);
                    while (have < needed) {
                        if (!tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent, {
                            candidatePool: pool,
                            ignoreFixedShift: ignoreFixed,
                            preferRemainingBudget: pass >= 1,
                        })) break;
                        have++;
                    }
                }
            }
        }
    }
    recomputeUncoveredStats(params, dayDemands);
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
    const { ctx, stats, isCustomCoverPosition } = params;

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

    // Cronológico: llenar desde el día 1 evita que el tope CCT del mes se agote
    // en días finales y deje la primera semana en F (0/4 cobertura).
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

        // Banda primero (4M global, luego 4T, luego 4N) → reparte mejor la dotación.
        for (const code of bandOrder) {
            for (const posDemand of rotPositions) {
                const needed = posDemand.bandSlots[code] || 0;
                if (needed <= 0) continue;
                const pos = ctx.positions.find(p => p.positionName === posDemand.positionName)!;
                let filled = 0;
                while (filled < needed) {
                    if (tryFillOneSlot(params, pos, day.dateStr, day.dayLetter, code, inCurrent)) {
                        filled++;
                    } else {
                        break;
                    }
                }
            }
        }

        // Segundo pase mismo día: huecos que quedaron por descanso/CCT (+ rescate global).
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

    recomputeUncoveredStats(params, dayDemands);
    return dayDemands;
}

export function shouldUseDemandDrivenScheduling(ctx: V2EngineContext): boolean {
    if (ctx.demandDriven === false) return false;
    const has24 = ctx.positions.some(p => {
        const cov = String(p.coverageType || '').toLowerCase();
        return cov === '24hs' || cov === '24' || cov === '24h';
    });
    return has24;
}
