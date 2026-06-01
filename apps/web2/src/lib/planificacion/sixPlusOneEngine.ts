/**
 * Motor ciclo 6+1: 6 guardias por puesto 24hs (2 por banda M/T/N).
 * Ciclo 7 días: 6 trabajo + 1 franco. Par A offset 0, Par B offset 3 →
 * francos nunca coinciden dentro del par (3 no es múltiplo de 7).
 * Ratio: 85.7 % vs 75 % del ciclo 6+2.
 */

import {
    positionIsActiveOn,
    type V2Assignment,
    type V2EngineContext,
    type V2GenerateResult,
    type V2PositionDef,
} from './autoScheduleEngineV2';

const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12']);
const BANDS_ORDERED = ['M', 'T', 'N'] as const;

const CYCLE_7 = 7;
const FRANCO_POS = 6;          // posición 6 de 7 = franco
const PAIR_B_OFFSET = 3;       // offset del 2do guardia del par; 3%7≠0 → nunca colisión

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
    const defaults: Record<string, { startTime: string; endTime?: string; hours?: number }> = {
        M: { startTime: '07:00', endTime: '15:00' },
        T: { startTime: '15:00', endTime: '23:00' },
        N: { startTime: '23:00', endTime: '07:00' },
        D12: { startTime: '07:00', endTime: '19:00', hours: 12 },
        N12: { startTime: '19:00', endTime: '07:00', hours: 12 },
        F: { startTime: '00:00', hours: 0 },
    };
    const d = defaults[upper] ?? defaults.M;
    return { name: upper === 'F' ? 'Franco' : upper, hours: d.hours ?? 8, startTime: d.startTime, ...(d.endTime ? { endTime: d.endTime } : {}) };
}

/**
 * En ciclo 6+1 no hay RET flotante — fallback directo a D12/N12 del compañero en franco.
 */
function patchAbsences6x1(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    openingSlotByEmp: Record<string, number>,
    primaryShiftByEmp: Record<string, string | null>,
    positionGroups: Record<string, string[]>,
    employeeMonthlyHours: Record<string, number>,
    employeeCycleHours: { current: Record<string, number>; next: Record<string, number> },
    cutoffDay: number,
): void {
    const aIdx = new Map<string, number>();
    assignments.forEach((a, i) => aIdx.set(`${a.empId}__${a.dateStr}`, i));

    for (const [posName, guardIds] of Object.entries(positionGroups)) {
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;

        ctx.daysInMonth.forEach((day, di) => {
            const dateStr = ctx.getDateKey(day);
            const absentWorkers = guardIds.filter(id => {
                if (!ctx.absences[id]?.has(dateStr)) return false;
                const op = openingSlotByEmp[id];
                return op !== undefined && (op + di) % CYCLE_7 !== FRANCO_POS;
            });
            if (!absentWorkers.length) return;

            for (const absentId of absentWorkers) {
                const neededBand = primaryShiftByEmp[absentId];
                if (!neededBand || !WORK_BANDS.has(neededBand)) continue;

                // ¿Otro guardia de la misma banda cubre ese día?
                const alreadyCovered = guardIds.some(id => {
                    if (id === absentId || ctx.absences[id]?.has(dateStr)) return false;
                    if (primaryShiftByEmp[id] !== neededBand) return false;
                    const op = openingSlotByEmp[id];
                    return op !== undefined && (op + di) % CYCLE_7 !== FRANCO_POS;
                });
                if (alreadyCovered) continue;

                // Compañero en F ese día → D12 o N12
                const francoId = guardIds.find(id => {
                    if (ctx.absences[id]?.has(dateStr)) return false;
                    const op = openingSlotByEmp[id];
                    return op !== undefined && (op + di) % CYCLE_7 === FRANCO_POS;
                });
                if (!francoId) continue;

                const fallbackCode = neededBand === 'N' ? 'N12' : 'D12';
                const ai = aIdx.get(`${francoId}__${dateStr}`);
                if (ai === undefined) continue;
                const meta = shiftMeta(pos, fallbackCode);
                assignments[ai] = {
                    empId: francoId,
                    dateStr,
                    positionName: posName,
                    code: fallbackCode,
                    name: meta.name,
                    hours: meta.hours,
                    startTime: meta.startTime,
                    ...(meta.endTime ? { endTime: meta.endTime } : {}),
                };
                employeeMonthlyHours[francoId] = (employeeMonthlyHours[francoId] || 0) + meta.hours;
                const inCurrent = day.getDate() <= cutoffDay;
                if (inCurrent) employeeCycleHours.current[francoId] = (employeeCycleHours.current[francoId] || 0) + meta.hours;
                else employeeCycleHours.next[francoId] = (employeeCycleHours.next[francoId] || 0) + meta.hours;
            }
        });
    }
}

function inferBand(empId: string, ctx: V2EngineContext): string | null {
    const lastCode = ctx.prevMonthLastShiftByEmp?.[empId]?.toUpperCase();
    if (lastCode && WORK_BANDS.has(lastCode)) return lastCode;
    const lastBand = ctx.prevMonthLastWorkBandBeforeRest?.[empId]?.toUpperCase();
    if (lastBand && WORK_BANDS.has(lastBand)) return lastBand;
    return null;
}

/**
 * Posición en el ciclo 7d (0-6) para el día 1 del mes.
 * 0 = primer día del bloque de trabajo, 6 = franco.
 */
export function inferCycleSlot7(
    lastCode: string | undefined,
    trailingWork: number | undefined,
): number {
    if (!lastCode) return 0;
    const code = lastCode.toUpperCase();
    if (FRANCO_CODES.has(code)) return 0;
    if (WORK_BANDS.has(code) || code === 'RET') {
        // trailing_work = k → día 1 del mes está en slot k (0-indexed)
        const k = Math.min(Math.max(1, trailingWork ?? 1), 6);
        return k % CYCLE_7;
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
 * true si todos los puestos son 24hs/7d y tienen un múltiplo de 6 guardias (6, 12, 18…).
 * Cada grupo de 6 forma 3 pares banda-fija (M×2, T×2, N×2) con ciclo 6+1.
 */
export function canUseSixPlusOne(ctx: V2EngineContext): boolean {
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

export function generateSixPlusOneSchedule(ctx: V2EngineContext): V2GenerateResult {
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

        // Dividir en grupos de 6: cada grupo forma sus propios 3 pares de banda
        const numGroups = Math.max(1, Math.floor(guardIds.length / 6));
        for (let gi = 0; gi < numGroups; gi++) {
            const groupIds = guardIds.slice(gi * 6, (gi + 1) * 6);
            const pairs = buildBandPairs(groupIds, ctx);
        for (const { band, guards } of pairs) {
            for (let pairIdx = 0; pairIdx < 2; pairIdx++) {
                const empId = guards[pairIdx];
                if (!empId) continue;

                // Slot inferido desde mes anterior; si no, cold start según posición en el par
                const inferredSlot = inferCycleSlot7(
                    ctx.prevMonthLastShiftByEmp?.[empId],
                    ctx.prevMonthTrailingWorkDays?.[empId],
                );
                // Si los dos guardias del par quedarían con el mismo franco (slot ≡ mismo mod 7),
                // desplazar al segundo por PAIR_B_OFFSET para evitar colisión.
                let openingSlot: number;
                if (pairIdx === 0) {
                    openingSlot = inferredSlot;
                } else {
                    const slotA = openingSlotByEmp[guards[0]];
                    const raw = inferredSlot;
                    openingSlot = (raw % CYCLE_7 === slotA % CYCLE_7)
                        ? (slotA + PAIR_B_OFFSET) % CYCLE_7
                        : raw;
                }

                openingSlotByEmp[empId] = openingSlot;
                primaryShiftByEmp[empId] = band;
                fixedBandSchemeByEmp[empId] = `6+1@${openingSlot}·${band}`;

                ctx.daysInMonth.forEach((day, di) => {
                    const dateStr = ctx.getDateKey(day);
                    if (ctx.absences[empId]?.has(dateStr)) return;
                    const dayLetter = ctx.getDayLetter(dateStr);
                    if (!positionIsActiveOn(pos, dayLetter)) return;

                    const cyclePos = (openingSlot + di) % CYCLE_7;
                    const isFranco = cyclePos === FRANCO_POS;
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
            }    // pairIdx
        }        // band pairs
        }        // gi (grupo de 6)
    }            // positionGroups

    patchAbsences6x1(
        ctx, assignments, openingSlotByEmp, primaryShiftByEmp, positionGroups,
        employeeMonthlyHours, employeeCycleHours, cutoffDay,
    );

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
