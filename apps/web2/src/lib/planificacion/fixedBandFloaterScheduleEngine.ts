/**
 * Grupos de ciclo 24d (6M+2F+6T+2F+6N+2F) escalonados — cobertura 4×M/T/N/F.
 * Continuidad desde mayo vía trailing + último código del mes anterior.
 */

import {
    positionIsActiveOn,
    type V2Assignment,
    type V2EngineContext,
    type V2GenerateResult,
    type V2PositionDef,
} from './autoScheduleEngineV2';

/** Ciclo 24 días: M→T→N con 2F entre bandas (sin N→M directo). */
export const CYCLE_24_MTN: readonly string[] = [
    ...Array(6).fill('M'),
    ...Array(2).fill('F'),
    ...Array(6).fill('T'),
    ...Array(2).fill('F'),
    ...Array(6).fill('N'),
    ...Array(2).fill('F'),
];

const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12']);
const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);

/** Apertura junio (índice 0..23) a partir del cierre de mayo. */
export function inferJune1CycleSlot(
    lastCode: string | undefined,
    trailingWork: number | undefined,
    trailingRest: number | undefined,
    lastWorkBandBeforeRest?: string,
): number | null {
    if (!lastCode) return null;
    const code = lastCode.toUpperCase();
    if (code === 'RET' || code === 'R') return null;

    for (let june1 = 0; june1 < 24; june1++) {
        const may31 = (june1 - 1 + 24) % 24;
        if (CYCLE_24_MTN[may31] !== code) continue;

        if (WORK_BANDS.has(code)) {
            const need = Math.max(1, trailingWork ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== code) break;
                ok++;
            }
            if (ok >= need) return june1;
        } else if (FRANCO_CODES.has(code)) {
            const need = Math.max(1, trailingRest ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== 'F') break;
                ok++;
            }
            if (ok < need) continue;
            if (!WORK_BANDS.has(CYCLE_24_MTN[june1])) continue;
            const beforeBlock = (may31 - need + 24) % 24;
            const bandBefore = lastWorkBandBeforeRest?.toUpperCase();
            if (bandBefore && CYCLE_24_MTN[beforeBlock] !== bandBefore) continue;
            return june1;
        }
    }
    return null;
}

/** Offsets por defecto (día 1: M/T/N/F) si no hay trailing de mayo. */
const COLD_START_OPENINGS = [4, 10, 16, 22];

function is24hs(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

function shiftMeta(pos: V2PositionDef, code: string): Pick<V2Assignment, 'name' | 'hours' | 'startTime' | 'endTime'> {
    const upper = code.toUpperCase();
    const sh = (pos.shifts || []).find(s => String(s.code || '').toUpperCase() === upper);
    if (sh) {
        const hours = Number(sh.hours) > 0 ? Number(sh.hours) : 8;
        return {
            name: sh.name || upper,
            hours,
            startTime: sh.startTime || '07:00',
            ...(sh.endTime ? { endTime: sh.endTime } : {}),
        };
    }
    const defaults: Record<string, { startTime: string; endTime?: string }> = {
        M: { startTime: '07:00', endTime: '15:00' },
        T: { startTime: '15:00', endTime: '23:00' },
        N: { startTime: '23:00', endTime: '07:00' },
        F: { startTime: '00:00' },
    };
    const d = defaults[upper] ?? defaults.M;
    return {
        name: upper === 'F' ? 'Franco' : upper,
        hours: upper === 'F' ? 0 : 8,
        startTime: d.startTime,
        ...(d.endTime ? { endTime: d.endTime } : {}),
    };
}

function buildPositionGroups(ctx: V2EngineContext): Record<string, string[]> {
    const positionGroups: Record<string, string[]> = {};
    ctx.positions.forEach(p => { positionGroups[p.positionName] = []; });
    const defaultPos = ctx.defaultPositionByEmp || {};
    const empAssigned = new Set<string>();

    for (const emp of ctx.employees) {
        const fixed = defaultPos[emp.id];
        if (!fixed || positionGroups[fixed] === undefined) continue;
        positionGroups[fixed].push(emp.id);
        empAssigned.add(emp.id);
    }

    const unassigned = ctx.employees.filter(e => !empAssigned.has(e.id));
    const posNames = ctx.positions.map(p => p.positionName);
    unassigned.forEach((emp, i) => {
        positionGroups[posNames[i % posNames.length]].push(emp.id);
    });
    return positionGroups;
}

function resolveOpeningSlotByEmp(ctx: V2EngineContext): Record<string, number> {
    const out: Record<string, number> = {};
    const withoutTrail: string[] = [];

    for (const emp of ctx.employees) {
        const slot = inferJune1CycleSlot(
            ctx.prevMonthLastShiftByEmp?.[emp.id],
            ctx.prevMonthTrailingWorkDays?.[emp.id],
            ctx.prevMonthTrailingRestDays?.[emp.id],
            ctx.prevMonthLastWorkBandBeforeRest?.[emp.id],
        );
        if (slot !== null) {
            out[emp.id] = slot;
        } else {
            withoutTrail.push(emp.id);
        }
    }

    withoutTrail.sort((a, b) => a.localeCompare(b));
    withoutTrail.forEach((empId, i) => {
        out[empId] = COLD_START_OPENINGS[i % COLD_START_OPENINGS.length];
    });
    return out;
}

/** true si cada puesto 24hs qty=1 tiene exactamente 4 guardias. */
export function canUseFixedBandFloater(ctx: V2EngineContext, positionGroups?: Record<string, string[]>): boolean {
    const groups = positionGroups ?? buildPositionGroups(ctx);
    let quartets = 0;
    for (const pos of ctx.positions) {
        if (!is24hs(pos)) continue;
        if (Math.max(1, Number(pos.qty) || 1) !== 1) return false;
        const g = groups[pos.positionName] || [];
        if (g.length !== 4) return false;
        quartets += 4;
    }
    return quartets > 0 && quartets === ctx.employees.length;
}

export function generateFixedBandFloaterSchedule(ctx: V2EngineContext): V2GenerateResult {
    const positionGroups = buildPositionGroups(ctx);
    const openingSlotByEmp = resolveOpeningSlotByEmp(ctx);
    const primaryShiftByEmp: Record<string, string | null> = {};

    const cutoffDay = ctx.cctCutoffDay && ctx.cctCutoffDay >= 1 && ctx.cctCutoffDay <= 31
        ? ctx.cctCutoffDay
        : 25;
    const assignments: V2Assignment[] = [];
    const employeeMonthlyHours: Record<string, number> = {};
    const employeeCycleHours = { current: {} as Record<string, number>, next: {} as Record<string, number> };
    ctx.employees.forEach(e => {
        employeeMonthlyHours[e.id] = 0;
        employeeCycleHours.current[e.id] = 0;
        employeeCycleHours.next[e.id] = 0;
    });

    for (const emp of ctx.employees) {
        const opening = openingSlotByEmp[emp.id];
        if (opening === undefined) continue;

        const posName = Object.entries(positionGroups).find(([, ids]) => ids.includes(emp.id))?.[0] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;

        ctx.daysInMonth.forEach((day, di) => {
            const dateStr = ctx.getDateKey(day);
            if (ctx.absences[emp.id]?.has(dateStr)) return;
            const dayLetter = ctx.getDayLetter(dateStr);
            if (!positionIsActiveOn(pos, dayLetter)) return;

            const code = CYCLE_24_MTN[(opening + di) % 24];
            if (di === 0) primaryShiftByEmp[emp.id] = WORK_BANDS.has(code) ? code : null;

            const meta = shiftMeta(pos, code);
            const isFranco = code === 'F';
            assignments.push({
                empId: emp.id,
                dateStr,
                positionName: isFranco ? '' : posName,
                code,
                name: meta.name,
                hours: meta.hours,
                startTime: meta.startTime,
                ...(meta.endTime ? { endTime: meta.endTime } : {}),
                ...(isFranco ? { isFranco: true } : {}),
            });

            if (BILLABLE.has(code)) {
                employeeMonthlyHours[emp.id] = (employeeMonthlyHours[emp.id] || 0) + meta.hours;
                const inCurrent = day.getDate() <= cutoffDay;
                if (inCurrent) {
                    employeeCycleHours.current[emp.id] = (employeeCycleHours.current[emp.id] || 0) + meta.hours;
                } else {
                    employeeCycleHours.next[emp.id] = (employeeCycleHours.next[emp.id] || 0) + meta.hours;
                }
            }
        });
    }

    const totalBillableHours = Object.values(employeeMonthlyHours).reduce((s, h) => s + h, 0);
    const slaTarget = Math.max(0, ctx.slaVendidas || 0);
    const slaDeficitRemaining = Math.max(0, Math.round((slaTarget - totalBillableHours) * 10) / 10);

    return {
        assignments,
        capOverflowSlots: [],
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
            fixedBandSchemeByEmp: Object.fromEntries(
                ctx.employees.map(e => [e.id, `6+2@${openingSlotByEmp[e.id] ?? '?'}`]),
            ),
        },
    };
}

// Tests unitarios lógicos (sin Firestore)
export function _debugCycleSlots(
    cases: Array<{ last: string; tw?: number; tr?: number; expect: number }>,
): boolean {
    return cases.every(c => inferJune1CycleSlot(c.last, c.tw, c.tr) === c.expect);
}
