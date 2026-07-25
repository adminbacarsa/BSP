/**
 * Utilidades: ausencia en día laboral vs franco del ciclo 24d (6M+2F+6T+2F+6N+2F).
 * Si el ausente caería en F, no hay brecha SLA — solo marcar la licencia/enfermedad.
 */

import type { V2Assignment, V2EngineContext, V2GenerateStats } from './autoScheduleEngineV2';
import { isCustomCoverPosition } from './autoScheduleEngineV2';
import { isExternalRetEmpId } from './externalRetCoverage';
import { isLabSyntheticEmpId } from './objectiveHeadcount';
import { CYCLE_24_MTN } from './fixedBandFloaterScheduleEngine';
import { isPlanningWorkShiftCode } from '@/lib/slaPlanningMatch';

const WORK_BANDS = new Set(['M', 'T', 'N']);

function isCustomCoverEmployee(empId: string, ctx: V2EngineContext): boolean {
    const posName = ctx.defaultPositionByEmp?.[empId];
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

/** RET solo en el designado; el resto pasa a Franco. */
export function consolidateRetToDesignee(
    assignments: V2Assignment[],
    designeeId: string | undefined,
): V2Assignment[] {
    if (!designeeId) {
        return assignments.map((a) => {
            if (String(a.code || '').toUpperCase() !== 'RET') return a;
            if (isExternalRetEmpId(a.empId)) return a;
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
        if (a.empId === designeeId) return a;
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

export function expectedBandForEmployee(
    empId: string,
    dateStr: string,
    openingSlotByEmp: Record<string, number>,
    daysInMonth: Date[],
    getDateKey: (d: Date) => string,
): string | null {
    const opening = openingSlotByEmp[empId];
    if (opening === undefined) return null;
    const di = daysInMonth.findIndex((d) => getDateKey(d) === dateStr);
    if (di < 0) return null;
    return String(CYCLE_24_MTN[(opening + di) % 24] || '').toUpperCase();
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

    for (const [empId, dateMap] of Object.entries(ctx.absences)) {
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

            if (isCustomCoverEmployee(emp.id, ctx)) {
                result.push({
                    empId: emp.id,
                    dateStr,
                    positionName: ctx.defaultPositionByEmp?.[emp.id] || '',
                    code: 'F',
                    name: 'Franco',
                    hours: 0,
                    startTime: '00:00',
                    isFranco: true,
                });
                keys.add(k);
                continue;
            }

            const useRet = !!retDesignee && emp.id === retDesignee;
            result.push({
                empId: emp.id,
                dateStr,
                positionName: '',
                code: useRet ? 'RET' : 'F',
                name: useRet ? 'Retén' : 'Franco',
                hours: 0,
                startTime: '00:00',
                isFranco: !useRet,
                isReten: useRet,
            });
            keys.add(k);
        }
    }

    return consolidateRetToDesignee(result, retDesignee);
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
): boolean {
    const posName = ctx.defaultPositionByEmp?.[empId];
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
