/**
 * Post-proceso Auto Lab: pool de excedentes en RET/F, sin D12/N12 salvo sustitución quirúrgica.
 */

import type { V2Assignment, V2EngineContext, V2GenerateStats } from './autoScheduleEngineV2';
import { pickRepresentativeCycle, positionIsActiveOn, is24hsRotationPosition } from './autoScheduleEngineV2';
import { isCustomCoverTitular } from './customCoverCycle';
import type { SurplusAbsentSubstitutionAction } from './surplusAbsentSubstitution';
import { isExternalRetEmpId } from './externalRetCoverage';
import { expectedBandForEmployee, isWorkBandCode } from './absenceFrancoUtils';

const BILLABLE_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'MA', 'ME']);
const ABSENCE_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG']);

const SHIFT_META: Record<string, { name: string; hours: number; startTime: string }> = {
    M: { name: 'Mañana', hours: 8, startTime: '07:00' },
    T: { name: 'Tarde', hours: 8, startTime: '15:00' },
    N: { name: 'Noche', hours: 8, startTime: '23:00' },
};

function buildTitularPositionMap(
    positionGroups: Record<string, string[]> | undefined,
): Record<string, string> {
    const map: Record<string, string> = {};
    if (!positionGroups) return map;
    for (const [posName, ids] of Object.entries(positionGroups)) {
        for (const id of ids) map[id] = posName;
    }
    return map;
}

function is24hsCoveragePosition(pos: { coverageType?: string; shifts?: { code?: string }[] }): boolean {
    return is24hsRotationPosition(pos as import('./autoScheduleEngineV2').V2PositionDef);
}

/**
 * Restaura M/T/N/F del ciclo 6+2 para titulares con opening slot (no excedentes).
 * El floater puede marcar índice ≥4 como RET; esto devuelve su cronograma fuera de ausencias.
 * No pisa turnos facturables del motor en puestos 24hs activos ese día.
 */
export function restoreRotationParticipantShifts(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    openingSlotByEmp: Record<string, number> | undefined,
    surplusPool: string[],
    positionGroups: Record<string, string[]> | undefined,
): void {
    if (!openingSlotByEmp || !positionGroups) return;

    const surplusSet = new Set(surplusPool);
    const empPos = buildTitularPositionMap(positionGroups);

    for (const emp of ctx.employees) {
        if (surplusSet.has(emp.id)) continue;
        if (employeeAssignedToCustomCover(emp.id, ctx.positions, positionGroups)) continue;
        if (openingSlotByEmp[emp.id] === undefined) continue;

        const posName = empPos[emp.id];
        if (!posName) continue;
        const posDef = ctx.positions.find((p) => p.positionName === posName);

        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            if (ctx.absences?.[emp.id]?.has(dateStr)) continue;

            const band = expectedBandForEmployee(
                emp.id,
                dateStr,
                openingSlotByEmp,
                ctx.daysInMonth,
                ctx.getDateKey,
                ctx,
            );
            if (!band) continue;

            let cell = assignments.find((a) => a.empId === emp.id && a.dateStr === dateStr);
            const dayLetter = ctx.getDayLetter(dateStr);
            const posActive24hs = !!posDef
                && is24hsCoveragePosition(posDef)
                && positionIsActiveOn(posDef, dayLetter);
            const cellBillable = cell
                && isWorkBandCode(String(cell.code))
                && (Number(cell.hours) || 0) > 0;

            if (!cell) {
                cell = {
                    empId: emp.id,
                    dateStr,
                    positionName: '',
                    code: 'F',
                    name: 'Franco',
                    hours: 0,
                    startTime: '00:00',
                };
                assignments.push(cell);
            }

            if (band === 'F') {
                if (posActive24hs && cellBillable) continue;
                cell.code = 'F';
                cell.name = 'Franco';
                cell.hours = 0;
                cell.startTime = '00:00';
                cell.positionName = '';
                cell.isFranco = true;
                cell.isReten = false;
                delete cell.endTime;
                continue;
            }

            if (!isWorkBandCode(band)) continue;

            if (
                cellBillable
                && cell.positionName === posName
                && String(cell.code).toUpperCase() === band
            ) {
                continue;
            }

            const meta = SHIFT_META[band] ?? { name: band, hours: 8, startTime: '07:00' };
            cell.code = band;
            cell.name = meta.name;
            cell.hours = meta.hours;
            cell.startTime = meta.startTime;
            cell.positionName = posName;
            cell.isFranco = false;
            cell.isReten = false;
            delete cell.endTime;
        }
    }
}

export function buildSubstitutionAllowance(
    actions: SurplusAbsentSubstitutionAction[],
): Set<string> {
    const keys = new Set<string>();
    for (const a of actions) {
        keys.add(`${a.surplusEmpId}__${a.dateStr}`);
    }
    return keys;
}

function protectCustomTitularAssignment(
    a: V2Assignment,
    positions?: V2PositionDef[],
    positionGroups?: Record<string, string[]>,
): boolean {
    if (!positions?.length) return false;
    if (isCustomCoverTitular(a.empId, positions, positionGroups)) return true;
    const code = String(a.code || '').toUpperCase();
    return BILLABLE_CODES.has(code) && code !== 'M' && code !== 'T' && code !== 'N' && code !== 'D12' && code !== 'N12';
}

/** Quita turnos facturables del pool excedente salvo celdas de sustitución puntual (M/T/N). */
export function enforceSurplusPoolStandbyPolicy(
    assignments: V2Assignment[],
    surplusPool: string[],
    allowedBillableKeys: Set<string>,
    positions?: V2PositionDef[],
    positionGroups?: Record<string, string[]>,
): void {
    const pool = new Set(surplusPool);
    for (let i = assignments.length - 1; i >= 0; i--) {
        const a = assignments[i];
        if (!pool.has(a.empId)) continue;
        if (protectCustomTitularAssignment(a, positions, positionGroups)) continue;
        const code = String(a.code || '').toUpperCase();
        if (!BILLABLE_CODES.has(code)) continue;
        const key = `${a.empId}__${a.dateStr}`;
        if (allowedBillableKeys.has(key)) continue;
        assignments.splice(i, 1);
    }
}

/**
 * Excedentes: sin RET/F de relleno mensual (pueden trabajar en otro objetivo).
 * Conserva sustituciones M/T/N y ausencias planificadas.
 */
export function stripSurplusStandbyAssignments(
    assignments: V2Assignment[],
    surplusPool: string[],
    allowedBillableKeys: Set<string>,
    positions?: V2PositionDef[],
    positionGroups?: Record<string, string[]>,
): void {
    const pool = new Set(surplusPool);
    for (let i = assignments.length - 1; i >= 0; i--) {
        const a = assignments[i];
        if (!pool.has(a.empId)) continue;
        if (protectCustomTitularAssignment(a, positions, positionGroups)) continue;
        const code = String(a.code || '').toUpperCase();
        if (ABSENCE_CODES.has(code)) continue;
        const key = `${a.empId}__${a.dateStr}`;
        if (allowedBillableKeys.has(key) && BILLABLE_CODES.has(code) && (Number(a.hours) || 0) > 0) {
            continue;
        }
        assignments.splice(i, 1);
    }
}

/** Franco obligatorio tras racha de trabajo en este objetivo (CCT 6+2, etc.). */
export function applySurplusRachaFrancos(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    surplusPool: string[],
    allowedBillableKeys: Set<string>,
): void {
    const pool = new Set(surplusPool);
    const { cL, cF } = pickRepresentativeCycle(ctx.autoCycles ?? ['6+2']);
    const dayIndex = new Map(ctx.daysInMonth.map((d, i) => [ctx.getDateKey(d), i]));
    const existing = new Set(assignments.map((a) => `${a.empId}__${a.dateStr}`));

    for (const empId of pool) {
        const workDates = assignments
            .filter((a) => {
                if (a.empId !== empId) return false;
                const key = `${a.empId}__${a.dateStr}`;
                if (!allowedBillableKeys.has(key)) return false;
                return isWorkBandCode(String(a.code)) && (Number(a.hours) || 0) > 0;
            })
            .map((a) => a.dateStr)
            .sort();

        if (workDates.length === 0) continue;

        const runs: string[][] = [];
        let run: string[] = [];
        for (const ds of workDates) {
            if (run.length === 0) {
                run = [ds];
                continue;
            }
            const prevIdx = dayIndex.get(run[run.length - 1]) ?? -1;
            const curIdx = dayIndex.get(ds) ?? -1;
            if (curIdx === prevIdx + 1) run.push(ds);
            else {
                runs.push(run);
                run = [ds];
            }
        }
        if (run.length > 0) runs.push(run);

        for (const r of runs) {
            if (r.length < cL) continue;
            const lastIdx = dayIndex.get(r[r.length - 1]) ?? -1;
            for (let f = 1; f <= cF; f++) {
                const fi = lastIdx + f;
                if (fi < 0 || fi >= ctx.daysInMonth.length) break;
                const dateStr = ctx.getDateKey(ctx.daysInMonth[fi]);
                const k = `${empId}__${dateStr}`;
                if (existing.has(k)) continue;
                assignments.push({
                    empId,
                    dateStr,
                    positionName: '',
                    code: 'F',
                    name: 'Franco',
                    hours: 0,
                    startTime: '00:00',
                    isFranco: true,
                });
                existing.add(k);
            }
        }
    }
}

/** Con excedente y sin Modo 12 del cerebro: revertir D12/N12 → M/N en titulares. */
export function demoteModo12ExtensionsWhenSurplusStandby(
    assignments: V2Assignment[],
    surplusPool: string[],
    allowedBillableKeys: Set<string>,
): void {
    if (surplusPool.length === 0) return;
    const surplusSet = new Set(surplusPool);
    for (const a of assignments) {
        if (surplusSet.has(a.empId)) continue;
        const key = `${a.empId}__${a.dateStr}`;
        if (allowedBillableKeys.has(key)) continue;
        const code = String(a.code || '').toUpperCase();
        if (code === 'D12') {
            a.code = 'M';
            a.name = 'Mañana';
            a.hours = 8;
            a.startTime = '07:00';
            delete a.endTime;
        } else if (code === 'N12') {
            a.code = 'N';
            a.name = 'Noche';
            a.hours = 8;
            a.startTime = '23:00';
            delete a.endTime;
        }
    }
}

/** Garantiza celda por guardia y día (evita "—" en grilla). */
export function ensureFullMonthCells(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    surplusPool: string[],
    openingSlotByEmp?: Record<string, number>,
): void {
    const pool = new Set(surplusPool);
    const keys = new Set(assignments.map((a) => `${a.empId}__${a.dateStr}`));

    for (const emp of ctx.employees) {
        if (isExternalRetEmpId(emp.id)) continue;
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            const k = `${emp.id}__${dateStr}`;
            if (keys.has(k)) continue;

            const absenceCode = ctx.absences?.[emp.id]?.get(dateStr);
            if (absenceCode) {
                assignments.push({
                    empId: emp.id,
                    dateStr,
                    positionName: '',
                    code: absenceCode,
                    name: absenceCode,
                    hours: 0,
                    startTime: '00:00',
                    isFranco: false,
                });
                keys.add(k);
                continue;
            }

            if (pool.has(emp.id)) {
                continue;
            }

            if (openingSlotByEmp) {
                const band = expectedBandForEmployee(
                    emp.id,
                    dateStr,
                    openingSlotByEmp,
                    ctx.daysInMonth,
                    ctx.getDateKey,
                    ctx,
                );
                if (band === 'F') {
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
                    keys.add(k);
                }
            }
        }
    }
}

export function finalizeAutoLabSurplusSchedule(params: {
    assignments: V2Assignment[];
    ctx: V2EngineContext;
    surplusPool: string[];
    substitutionActions: SurplusAbsentSubstitutionAction[];
    openingSlotByEmp?: Record<string, number>;
    positionGroups?: Record<string, string[]>;
    /** Si true, re-aplica el ciclo MTN tras sustituciones quirúrgicas del pool excedente. */
    restoreRotationAfterSubstitution?: boolean;
}): V2Assignment[] {
    const result = params.assignments.map((a) => ({ ...a }));
    const allowance = buildSubstitutionAllowance(params.substitutionActions);
    if (
        params.surplusPool.length > 0
        && params.restoreRotationAfterSubstitution === true
        && params.substitutionActions.length > 0
    ) {
        restoreRotationParticipantShifts(
            result,
            params.ctx,
            params.openingSlotByEmp,
            params.surplusPool,
            params.positionGroups,
        );
    }
    demoteModo12ExtensionsWhenSurplusStandby(result, params.surplusPool, allowance);
    enforceSurplusPoolStandbyPolicy(
        result,
        params.surplusPool,
        allowance,
        params.ctx.positions,
        params.positionGroups,
    );
    stripSurplusStandbyAssignments(
        result,
        params.surplusPool,
        allowance,
        params.ctx.positions,
        params.positionGroups,
    );
    applySurplusRachaFrancos(result, params.ctx, params.surplusPool, allowance);
    ensureFullMonthCells(result, params.ctx, params.surplusPool, params.openingSlotByEmp);
    return result;
}

/** Recalcula horas facturables y banda primaria desde assignments finales (post-proceso). */
export function recomputeScheduleStatsFromAssignments(
    assignments: V2Assignment[],
    baseStats: V2GenerateStats,
    employeeIds: string[],
): Pick<V2GenerateStats, 'totalAssignments' | 'totalBillableHours' | 'employeeMonthlyHours' | 'primaryShiftByEmp'> {
    const employeeMonthlyHours: Record<string, number> = {};
    for (const id of employeeIds) employeeMonthlyHours[id] = 0;

    for (const a of assignments) {
        const h = Number(a.hours) || 0;
        if (h > 0) {
            employeeMonthlyHours[a.empId] = (employeeMonthlyHours[a.empId] || 0) + h;
        }
    }

    const primaryShiftByEmp: Record<string, string | null> = {
        ...(baseStats.primaryShiftByEmp ?? {}),
    };
    for (const empId of employeeIds) {
        const existing = primaryShiftByEmp[empId];
        if (existing != null && isWorkBandCode(String(existing))) continue;
        const firstWork = assignments
            .filter((a) => {
                if (a.empId !== empId) return false;
                const c = String(a.code || '').toUpperCase();
                return isWorkBandCode(c) && (Number(a.hours) || 0) > 0;
            })
            .sort((a, b) => a.dateStr.localeCompare(b.dateStr))[0];
        if (firstWork) {
            primaryShiftByEmp[empId] = String(firstWork.code).toUpperCase();
        }
    }

    return {
        totalAssignments: assignments.length,
        totalBillableHours: Object.values(employeeMonthlyHours).reduce((s, h) => s + h, 0),
        employeeMonthlyHours,
        primaryShiftByEmp,
    };
}
