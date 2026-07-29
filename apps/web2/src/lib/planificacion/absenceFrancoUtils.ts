/**
 * Utilidades: ausencia en día laboral vs franco del ciclo 24d (6M+2F+6T+2F+6N+2F).
 * Si el ausente caería en F, no hay brecha SLA — solo marcar la licencia/enfermedad.
 */

import type { V2Assignment, V2EngineContext, V2GenerateStats } from './autoScheduleEngineV2';
import { isCustomCoverPosition } from './autoScheduleEngineV2';
import { isPlannedCustomCoverRetAssignment, plannedCustomCoverRestCode } from './customCoverCycle';
import { isExternalRetEmpId } from './externalRetCoverage';
import { isLabSyntheticEmpId } from './objectiveHeadcount';
import { CYCLE_24_MTN } from './fixedBandFloaterScheduleEngine';
import { isPlanningWorkShiftCode } from '@/lib/slaPlanningMatch';
import {
    enforceSurplusRetCycleOnAssignments,
    isIdleSurplusEmployee,
    resolveMonthStartGlobalDayIndex,
    surplusStandbyCodeForDay,
} from './surplusRetCycle';

const WORK_BANDS = new Set(['M', 'T', 'N']);

function resolveEmployeePositionName(
    empId: string,
    ctx: V2EngineContext,
    stats?: Pick<V2GenerateStats, 'positionGroups'>,
): string | undefined {
    const groups = stats?.positionGroups;
    if (groups) {
        for (const [posName, empIds] of Object.entries(groups)) {
            if (empIds.includes(empId)) return posName;
        }
    }
    return ctx.defaultPositionByEmp?.[empId];
}

function isCustomCoverEmployee(
    empId: string,
    ctx: V2EngineContext,
    stats?: Pick<V2GenerateStats, 'positionGroups'>,
): boolean {
    const posName = resolveEmployeePositionName(empId, ctx, stats);
    if (!posName) return false;
    const pos = ctx.positions.find((p) => p.positionName === posName);
    return !!pos && isCustomCoverPosition(pos);
}

function is24hsPosition(pos: { coverageType?: string }): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

/**
 * Elige un único guardia RET del objetivo (stand-by). Prioridad: sintético ocioso → motor → ocioso sin puesto fijo → menor horas 24hs.
 */
export function pickRetDesignee(
    ctx: V2EngineContext,
    stats?: Pick<V2GenerateStats, 'idleEmployeeIds' | 'employeeRetCount' | 'employeeMonthlyHours' | 'positionGroups' | 'retDesignateEmpIds'>,
    assignments?: V2Assignment[],
): string | undefined {
    const fromEngine = stats?.retDesignateEmpIds?.[0];
    if (fromEngine) return fromEngine;

    const lockedCustomTitulars = new Set(
        Object.entries(ctx.defaultPositionByEmp || {})
            .filter(([empId, posName]) => {
                if (isLabSyntheticEmpId(empId)) return false;
                const pos = ctx.positions.find((p) => p.positionName === posName);
                return !!pos && isCustomCoverPosition(pos);
            })
            .map(([empId]) => empId),
    );

    const isEligibleRet = (empId: string) =>
        !lockedCustomTitulars.has(empId) && !isExternalRetEmpId(empId);

    const paddedIdle = ctx.employees.filter(
        (e) => isLabSyntheticEmpId(e.id) && isEligibleRet(e.id),
    );
    if (paddedIdle.length > 0) {
        const hours = stats?.employeeMonthlyHours ?? {};
        paddedIdle.sort((a, b) => (hours[a.id] || 0) - (hours[b.id] || 0));
        return paddedIdle[0].id;
    }

    if (stats?.idleEmployeeIds?.length) {
        const idle = stats.idleEmployeeIds.find(isEligibleRet);
        if (idle) return idle;
    }

    if (stats?.employeeRetCount) {
        const top = Object.entries(stats.employeeRetCount)
            .filter(([id]) => isEligibleRet(id))
            .sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] > 0) return top[0];
    }

    if (assignments?.length) {
        const retByEmp: Record<string, number> = {};
        for (const a of assignments) {
            if (String(a.code || '').toUpperCase() !== 'RET') continue;
            if (!isEligibleRet(a.empId)) continue;
            retByEmp[a.empId] = (retByEmp[a.empId] || 0) + 1;
        }
        const top = Object.entries(retByEmp).sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] > 0) return top[0];
    }

    const primary24 = ctx.positions.find((p) => is24hsPosition(p) && !isCustomCoverPosition(p));
    const group = primary24 && stats?.positionGroups
        ? (stats.positionGroups[primary24.positionName] || [])
        : [];
    if (group.length > 0) {
        const hours = stats?.employeeMonthlyHours ?? {};
        const sorted = [...group]
            .filter(isEligibleRet)
            .sort((a, b) => (hours[a] || 0) - (hours[b] || 0));
        if (sorted.length > 0) return sorted[0];
    }

    return undefined;
}

/** RET solo en el pool de sobrantes; el resto pasa a Franco (salvo RET planificado custom L–V). */
export function consolidateRetToDesignee(
    assignments: V2Assignment[],
    designeeId: string | undefined,
    ctx?: Pick<V2EngineContext, 'positions' | 'defaultPositionByEmp' | 'getDayLetter'>,
    allowedRetEmpIds?: string[],
    positionGroups?: Record<string, string[]>,
): V2Assignment[] {
    const allowed = new Set(
        allowedRetEmpIds?.length
            ? allowedRetEmpIds
            : (designeeId ? [designeeId] : []),
    );
    const preservePlannedCustomRet = (a: V2Assignment): boolean => {
        if (!ctx) return false;
        const dayLetter = ctx.getDayLetter(a.dateStr);
        return isPlannedCustomCoverRetAssignment(
            a.empId,
            dayLetter,
            ctx.positions,
            ctx.defaultPositionByEmp,
            a.dateStr,
            positionGroups,
        );
    };

    if (allowed.size === 0) {
        return assignments.map((a) => {
            if (String(a.code || '').toUpperCase() !== 'RET') return a;
            if (isExternalRetEmpId(a.empId)) return a;
            if (a.balancedLdCctRet === true) return a;
            if (preservePlannedCustomRet(a)) return a;
            return {
                ...a,
                code: 'F',
                name: 'Franco',
                hours: 0,
                startTime: '00:00',
                positionName: '',
                isFranco: true,
                isReten: false,
            };
        });
    }
    return assignments.map((a) => {
        if (String(a.code || '').toUpperCase() !== 'RET') return a;
        if (isExternalRetEmpId(a.empId)) return a;
        if (a.balancedLdCctRet === true) return a;
        if (allowed.has(a.empId)) return a;
        if (preservePlannedCustomRet(a)) return a;
        return {
            ...a,
            code: 'F',
            name: 'Franco',
            hours: 0,
            startTime: '00:00',
            positionName: '',
            isFranco: true,
            isReten: false,
        };
    });
}

type ExpectedBandCtx = Pick<V2EngineContext, 'monthStartGlobalDayIndex' | 'daysInMonth'>;

export function expectedBandForEmployee(
    empId: string,
    dateStr: string,
    openingSlotByEmp: Record<string, number> | undefined,
    daysInMonth: Date[],
    getDateKey: (d: Date) => string,
    monthStartOrCtx?: number | ExpectedBandCtx,
): string | null {
    if (!openingSlotByEmp) return null;
    const opening = openingSlotByEmp[empId];
    if (opening === undefined) return null;
    const di = daysInMonth.findIndex((d) => getDateKey(d) === dateStr);
    if (di < 0) return null;
    let monthStart: number;
    if (typeof monthStartOrCtx === 'number') {
        monthStart = monthStartOrCtx;
    } else if (monthStartOrCtx) {
        monthStart = resolveMonthStartGlobalDayIndex(monthStartOrCtx);
    } else {
        const d0 = daysInMonth[0];
        if (!d0) return null;
        const ANCHOR = new Date(2020, 0, 1);
        monthStart = Math.round((d0.getTime() - ANCHOR.getTime()) / 86_400_000);
    }
    return String(CYCLE_24_MTN[(opening + monthStart + di) % 24] || '').toUpperCase();
}

export function isWorkBandCode(code: string | null | undefined): boolean {
    return WORK_BANDS.has(String(code || '').toUpperCase());
}

/** true = el ausente habría trabajado M/T/N ese día → hay que cubrir. */
export function absenceRequiresCoverage(
    empId: string,
    dateStr: string,
    openingSlotByEmp: Record<string, number> | undefined,
    ctx: Pick<V2EngineContext, 'daysInMonth' | 'getDateKey'>,
): boolean {
    if (!openingSlotByEmp) return true;
    const band = expectedBandForEmployee(
        empId,
        dateStr,
        openingSlotByEmp,
        ctx.daysInMonth,
        ctx.getDateKey,
        ctx,
    );
    if (!band) return true;
    return isWorkBandCode(band);
}

/** Marca celdas de ausencia (incl. días que serían franco del ciclo). */
export function ensureAbsenceCells(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
): V2Assignment[] {
    const result = [...assignments];
    const keys = new Set(result.map((a) => `${a.empId}__${a.dateStr}`));

    for (const [empId, dateMap] of Object.entries(ctx.absences ?? {})) {
        for (const [dateStr, code] of dateMap.entries()) {
            const k = `${empId}__${dateStr}`;
            if (keys.has(k)) {
                const cell = result.find((a) => a.empId === empId && a.dateStr === dateStr);
                if (cell) {
                    cell.code = code;
                    cell.name = code;
                    cell.hours = 0;
                    cell.startTime = '00:00';
                    cell.isFranco = false;
                    cell.isReten = false;
                }
                continue;
            }
            const pos = ctx.defaultPositionByEmp?.[empId] || '';
            result.push({
                empId,
                dateStr,
                positionName: pos,
                code,
                name: code,
                hours: 0,
                startTime: '00:00',
                isFranco: false,
            });
            keys.add(k);
        }
    }

    return result;
}

/**
 * Completa celdas vacías. RET solo para el guardia designado (1 por objetivo); resto → F.
 */
export function fillEmptyCellsWithRet(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    openingSlotByEmp?: Record<string, number>,
    options?: {
        retDesignateId?: string;
        stats?: Pick<V2GenerateStats, 'idleEmployeeIds' | 'employeeRetCount' | 'employeeMonthlyHours' | 'positionGroups' | 'retDesignateEmpIds'>;
    },
): V2Assignment[] {
    const result = [...assignments];
    const keys = new Set(result.map((a) => `${a.empId}__${a.dateStr}`));
    const retDesignee = options?.retDesignateId ?? pickRetDesignee(ctx, options?.stats, result);

    for (const emp of ctx.employees) {
        if (isExternalRetEmpId(emp.id)) continue;
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            const k = `${emp.id}__${dateStr}`;
            if (keys.has(k)) continue;

            const absenceCode = ctx.absences[emp.id]?.get(dateStr);
            if (absenceCode) {
                result.push({
                    empId: emp.id,
                    dateStr,
                    positionName: ctx.defaultPositionByEmp?.[emp.id] || '',
                    code: absenceCode,
                    name: absenceCode,
                    hours: 0,
                    startTime: '00:00',
                    isFranco: false,
                });
                keys.add(k);
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
                    result.push({
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
                    continue;
                }
            }

            if (isCustomCoverEmployee(emp.id, ctx, options?.stats)) {
                const dayLetter = ctx.getDayLetter(dateStr);
                const motorPos = resolveEmployeePositionName(emp.id, ctx, options?.stats);
                const positionByEmp = motorPos
                    ? { ...(ctx.defaultPositionByEmp || {}), [emp.id]: motorPos }
                    : ctx.defaultPositionByEmp;
                const restCode = plannedCustomCoverRestCode(
                    emp.id,
                    dayLetter,
                    ctx.positions,
                    positionByEmp,
                    dateStr,
                    options?.stats?.positionGroups,
                ) ?? 'F';
                result.push({
                    empId: emp.id,
                    dateStr,
                    positionName: motorPos || ctx.defaultPositionByEmp?.[emp.id] || '',
                    code: restCode,
                    name: restCode === 'RET' ? 'Retén' : restCode === 'FF' ? 'Franco feriado' : 'Franco',
                    hours: 0,
                    startTime: '00:00',
                    isFranco: restCode === 'F' || restCode === 'FF',
                    isReten: restCode === 'RET',
                });
                keys.add(k);
                continue;
            }

            const retPool = new Set([
                ...(options?.stats?.retDesignateEmpIds ?? []),
                ...(options?.retDesignateId ? [options.retDesignateId] : []),
            ]);
            const useRetPool = retPool.has(emp.id);
            const standbyCode = useRetPool && (
                isIdleSurplusEmployee(emp.id, options?.stats?.idleEmployeeIds)
                || isLabSyntheticEmpId(emp.id)
            )
                ? surplusStandbyCodeForDay(ctx, emp.id, dateStr)
                : (useRetPool ? 'RET' : 'F');
            result.push({
                empId: emp.id,
                dateStr,
                positionName: '',
                code: standbyCode,
                name: standbyCode === 'RET' ? 'Retén' : 'Franco',
                hours: 0,
                startTime: '00:00',
                isFranco: standbyCode === 'F',
                isReten: standbyCode === 'RET',
            });
            keys.add(k);
        }
    }

    enforceSurplusRetCycleOnAssignments(
        result,
        ctx,
        retDesignee,
        [
            ...(options?.stats?.idleEmployeeIds ?? []),
            ...(options?.stats?.retDesignateEmpIds ?? []),
        ],
    );

    return consolidateRetToDesignee(
        result,
        retDesignee,
        ctx,
        options?.stats?.retDesignateEmpIds,
    );
}

function isPositionExcludedOnDate(
    pos: { excludedDates?: string[] } | null | undefined,
    dateStr: string,
    globalExcluded: Set<string>,
): boolean {
    if (globalExcluded.has(dateStr)) return true;
    return !!pos?.excludedDates?.includes(dateStr);
}

function isEmployeeServiceOffOnDate(
    empId: string,
    dateStr: string,
    ctx: V2EngineContext,
    globalExcluded: Set<string>,
    stats?: Pick<V2GenerateStats, 'positionGroups'>,
): boolean {
    const posName = resolveEmployeePositionName(empId, ctx, stats);
    if (!posName) return globalExcluded.has(dateStr);
    const pos = ctx.positions.find((p) => p.positionName === posName);
    return isPositionExcludedOnDate(pos, dateStr, globalExcluded);
}

/**
 * Días sin servicio (feriado puente / exclusión SLA): sin demanda de cobertura.
 * El personal pasa a RET (stand-by para otro objetivo); francos y licencias se respetan.
 */
export function applyServiceExcludedDays(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
): V2Assignment[] {
    const globalExcluded = new Set(ctx.serviceExcludedDates || []);
    const hasPerPosExcluded = ctx.positions.some((p) => (p.excludedDates?.length ?? 0) > 0);
    if (globalExcluded.size === 0 && !hasPerPosExcluded) return assignments;

    const calendarDays = ctx.calendarDaysInMonth?.length
        ? ctx.calendarDaysInMonth
        : ctx.daysInMonth;
    if (calendarDays.length === 0) return assignments;

    const result = assignments.map((a) => ({ ...a }));
    const byKey = new Map(result.map((a) => [`${a.empId}__${a.dateStr}`, a]));

    for (const day of calendarDays) {
        const dateStr = ctx.getDateKey(day);
        const dayHasExclusion = globalExcluded.has(dateStr)
            || ctx.positions.some((p) => p.excludedDates?.includes(dateStr));
        if (!dayHasExclusion) continue;

        for (const emp of ctx.employees) {
            if (isExternalRetEmpId(emp.id)) continue;
            if (!isEmployeeServiceOffOnDate(emp.id, dateStr, ctx, globalExcluded)) continue;

            const absenceCode = ctx.absences[emp.id]?.get(dateStr);
            const key = `${emp.id}__${dateStr}`;
            const existing = byKey.get(key);

            if (absenceCode) {
                if (!existing) {
                    const cell: V2Assignment = {
                        empId: emp.id,
                        dateStr,
                        positionName: ctx.defaultPositionByEmp?.[emp.id] || '',
                        code: absenceCode,
                        name: absenceCode,
                        hours: 0,
                        startTime: '00:00',
                        isFranco: false,
                    };
                    result.push(cell);
                    byKey.set(key, cell);
                }
                continue;
            }

            if (existing) {
                if (isPlanningWorkShiftCode(existing.code)) {
                    existing.code = 'RET';
                    existing.name = 'Retén';
                    existing.hours = 0;
                    existing.positionName = '';
                    existing.isReten = true;
                    existing.isFranco = false;
                    delete existing.endTime;
                }
                continue;
            }

            const cell: V2Assignment = {
                empId: emp.id,
                dateStr,
                positionName: '',
                code: 'RET',
                name: 'Retén',
                hours: 0,
                startTime: '00:00',
                isReten: true,
            };
            result.push(cell);
            byKey.set(key, cell);
        }
    }

    return result;
}
