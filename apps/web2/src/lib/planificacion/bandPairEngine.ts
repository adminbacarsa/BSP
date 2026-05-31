/**
 * Motor genérico de bandas fijas por pares (M/T/N × 2).
 * Soporta ciclo 5+1 (5 trabajo + 1 franco) y 6+1 (6 trabajo + 1 franco).
 * Cada par usa offset PAIR_B_OFFSET=3 para que los francos nunca coincidan
 * dentro del par (3 no es múltiplo de 6 ni de 7).
 */

import {
    positionIsActiveOn,
    type V2Assignment,
    type V2EngineContext,
    type V2GenerateResult,
    type V2PositionDef,
} from './autoScheduleEngineV2';

export type BandPairCycle = '5+1' | '6+1';

export interface BandPairCycleInfo {
    cycleLen: number;
    francoPos: number;
    pairBOffset: number;
    workDaysPerCycle: number;
    ratio: number;
    approxMonthlyHours: number;
    label: string;
    description: string;
}

export const BAND_PAIR_CYCLE_INFO: Record<BandPairCycle, BandPairCycleInfo> = {
    '5+1': {
        cycleLen: 6,
        francoPos: 5,
        pairBOffset: 3,
        workDaysPerCycle: 5,
        ratio: 5 / 6,
        approxMonthlyHours: 200,
        label: '5+1',
        description: '200h exactas · tope CCT',
    },
    '6+1': {
        cycleLen: 7,
        francoPos: 6,
        pairBOffset: 3,
        workDaysPerCycle: 6,
        ratio: 6 / 7,
        approxMonthlyHours: 205.7,
        label: '6+1',
        description: '~206h · puede requerir auth >200h',
    },
};

const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12']);
const BANDS_ORDERED = ['M', 'T', 'N'] as const;

function is24hs(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

function shiftMeta(pos: V2PositionDef, code: string) {
    const upper = code.toUpperCase();
    const sh = (pos.shifts || []).find(s => String(s.code || '').toUpperCase() === upper);
    if (sh) {
        const hours = Number(sh.hours) > 0 ? Number(sh.hours) : 8;
        return { name: sh.name || upper, hours, startTime: sh.startTime || '07:00', ...(sh.endTime ? { endTime: sh.endTime } : {}) };
    }
    const defaults: Record<string, { startTime: string; endTime?: string }> = {
        M: { startTime: '07:00', endTime: '15:00' },
        T: { startTime: '15:00', endTime: '23:00' },
        N: { startTime: '23:00', endTime: '07:00' },
        F: { startTime: '00:00' },
    };
    const d = defaults[upper] ?? defaults.M;
    return { name: upper === 'F' ? 'Franco' : upper, hours: upper === 'F' ? 0 : 8, startTime: d.startTime, ...(d.endTime ? { endTime: d.endTime } : {}) };
}

function inferBand(empId: string, ctx: V2EngineContext): string | null {
    const lastCode = ctx.prevMonthLastShiftByEmp?.[empId]?.toUpperCase();
    if (lastCode && WORK_BANDS.has(lastCode)) return lastCode;
    const lastBand = ctx.prevMonthLastWorkBandBeforeRest?.[empId]?.toUpperCase();
    if (lastBand && WORK_BANDS.has(lastBand)) return lastBand;
    return null;
}

/**
 * Posición en el ciclo (0..cycleLen-1) para el día 1 del mes.
 * Franco → 0 (inicio de nuevo bloque de trabajo).
 * Trabajo con k días trailing → k % cycleLen.
 */
export function inferCycleSlot(
    lastCode: string | undefined,
    trailingWork: number | undefined,
    cycleLen: number,
): number {
    if (!lastCode) return 0;
    const code = lastCode.toUpperCase();
    if (FRANCO_CODES.has(code)) return 0;
    if (WORK_BANDS.has(code) || code === 'RET') {
        const k = Math.min(Math.max(1, trailingWork ?? 1), cycleLen - 1);
        return k % cycleLen;
    }
    return 0;
}

function buildPositionGroups(ctx: V2EngineContext): Record<string, string[]> {
    const groups: Record<string, string[]> = {};
    ctx.positions.forEach(p => { groups[p.positionName] = []; });
    const defaultPos = ctx.defaultPositionByEmp || {};
    const assigned = new Set<string>();

    for (const emp of ctx.employees) {
        const fixed = defaultPos[emp.id];
        if (!fixed || groups[fixed] === undefined) continue;
        groups[fixed].push(emp.id);
        assigned.add(emp.id);
    }
    const unassigned = ctx.employees.filter(e => !assigned.has(e.id));
    const posNames = ctx.positions.map(p => p.positionName);
    unassigned.forEach((emp, i) => { groups[posNames[i % posNames.length]].push(emp.id); });
    return groups;
}

interface BandPair { band: string; guards: [string, string] }

function buildBandPairs(guardIds: string[], ctx: V2EngineContext): BandPair[] {
    const bandMap: Record<string, string[]> = { M: [], T: [], N: [] };
    const unassigned: string[] = [];
    for (const id of guardIds) {
        const band = inferBand(id, ctx);
        if (band && bandMap[band].length < 2) {
            bandMap[band].push(id);
        } else {
            unassigned.push(id);
        }
    }
    unassigned.sort((a, b) => a.localeCompare(b));
    for (const id of unassigned) {
        const band = BANDS_ORDERED.find(b => bandMap[b].length < 2);
        if (band) bandMap[band].push(id);
    }
    return BANDS_ORDERED
        .filter(b => bandMap[b][0] && bandMap[b][1])
        .map(b => ({ band: b, guards: [bandMap[b][0], bandMap[b][1]] as [string, string] }));
}

/**
 * Verdadero si todos los puestos son 24hs/7d y el total de guardias
 * por puesto es un múltiplo de 6 (6, 12, 18…).
 * Aplica tanto a 5+1 como 6+1 — ambos usan grupos de 6.
 */
export function canUseBandPairCycle(ctx: V2EngineContext): boolean {
    const groups = buildPositionGroups(ctx);
    let counted = 0;
    for (const pos of ctx.positions) {
        if (!is24hs(pos)) return false;
        if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7) return false;
        const g = groups[pos.positionName] || [];
        if (g.length === 0 || g.length % 6 !== 0) return false;
        counted += g.length;
    }
    return counted > 0 && counted === ctx.employees.length;
}

export function generateBandPairSchedule(ctx: V2EngineContext, cycle: BandPairCycle): V2GenerateResult {
    const cfg = BAND_PAIR_CYCLE_INFO[cycle];
    const { cycleLen, francoPos, pairBOffset } = cfg;

    const positionGroups = buildPositionGroups(ctx);
    const cutoffDay = ctx.cctCutoffDay && ctx.cctCutoffDay >= 1 && ctx.cctCutoffDay <= 31
        ? ctx.cctCutoffDay : 25;

    const assignments: V2Assignment[] = [];
    const employeeMonthlyHours: Record<string, number> = {};
    const employeeCycleHours = { current: {} as Record<string, number>, next: {} as Record<string, number> };
    const primaryShiftByEmp: Record<string, string | null> = {};
    const openingSlotByEmp: Record<string, number> = {};
    const fixedBandSchemeByEmp: Record<string, string> = {};

    ctx.employees.forEach(e => {
        employeeMonthlyHours[e.id] = 0;
        employeeCycleHours.current[e.id] = 0;
        employeeCycleHours.next[e.id] = 0;
    });

    for (const [posName, guardIds] of Object.entries(positionGroups)) {
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;

        const numGroups = Math.max(1, Math.floor(guardIds.length / 6));
        for (let gi = 0; gi < numGroups; gi++) {
            const groupIds = guardIds.slice(gi * 6, (gi + 1) * 6);
            const pairs = buildBandPairs(groupIds, ctx);

            for (const { band, guards } of pairs) {
                for (let pairIdx = 0; pairIdx < 2; pairIdx++) {
                    const empId = guards[pairIdx];
                    if (!empId) continue;

                    const inferredSlot = inferCycleSlot(
                        ctx.prevMonthLastShiftByEmp?.[empId],
                        ctx.prevMonthTrailingWorkDays?.[empId],
                        cycleLen,
                    );

                    let openingSlot: number;
                    if (pairIdx === 0) {
                        openingSlot = inferredSlot;
                    } else {
                        const slotA = openingSlotByEmp[guards[0]];
                        openingSlot = (inferredSlot % cycleLen === slotA % cycleLen)
                            ? (slotA + pairBOffset) % cycleLen
                            : inferredSlot;
                    }

                    openingSlotByEmp[empId] = openingSlot;
                    primaryShiftByEmp[empId] = band;
                    fixedBandSchemeByEmp[empId] = `${cycle}@${openingSlot}·${band}`;

                    ctx.daysInMonth.forEach((day, di) => {
                        const dateStr = ctx.getDateKey(day);
                        if (ctx.absences[empId]?.has(dateStr)) return;
                        const dayLetter = ctx.getDayLetter(dateStr);
                        if (!positionIsActiveOn(pos, dayLetter)) return;

                        const cyclePos = (openingSlot + di) % cycleLen;
                        const isFranco = cyclePos === francoPos;
                        const code = isFranco ? 'F' : band;
                        const meta = shiftMeta(pos, code);

                        assignments.push({
                            empId,
                            dateStr,
                            positionName: isFranco ? '' : posName,
                            code,
                            name: meta.name,
                            hours: meta.hours,
                            startTime: meta.startTime,
                            ...(!isFranco && meta.endTime ? { endTime: meta.endTime } : {}),
                            ...(isFranco ? { isFranco: true } : {}),
                        });

                        if (BILLABLE.has(code)) {
                            employeeMonthlyHours[empId] = (employeeMonthlyHours[empId] || 0) + meta.hours;
                            if (day.getDate() <= cutoffDay) {
                                employeeCycleHours.current[empId] = (employeeCycleHours.current[empId] || 0) + meta.hours;
                            } else {
                                employeeCycleHours.next[empId] = (employeeCycleHours.next[empId] || 0) + meta.hours;
                            }
                        }
                    });
                }
            }
        }
    }

    const totalBillableHours = Object.values(employeeMonthlyHours).reduce((s, h) => s + h, 0);
    const slaTarget = Math.max(0, ctx.slaVendidas || 0);
    const slaDeficitRemaining = Math.max(0, Math.round((slaTarget - totalBillableHours) * 10) / 10);

    return {
        assignments,
        capOverflowSlots: [],
        coverageViolations: 0,
        feasibility: null as any,
        stats: {
            totalAssignments: assignments.length,
            totalBillableHours,
            targetHours: slaTarget,
            uncoveredSlots: 0,
            employeeMonthlyHours,
            employeeCycleHours,
            employeesOver200: [],
            positionGroups,
            idleEmployeeIds: ctx.employees.filter(e => openingSlotByEmp[e.id] === undefined).map(e => e.id),
            primaryShiftByEmp,
            slaDeficitRemaining,
            slaHoursClosed: slaDeficitRemaining <= 0.5,
            fixedBandSchemeByEmp,
        },
    };
}
