/**
 * Ciclo CCT para guardias sobrantes (sin puesto asignado): stand-by RET en días
 * laborables del ciclo y Franco en días de descanso (6+2, 6+1, etc.).
 */

import type { V2Assignment, V2EngineContext } from './autoScheduleEngineV2';
import { pickRepresentativeCycle } from './autoScheduleEngineV2';

export function resolveMonthStartGlobalDayIndex(ctx: V2EngineContext): number {
    if (ctx.monthStartGlobalDayIndex !== undefined) return ctx.monthStartGlobalDayIndex;
    const d0 = ctx.daysInMonth[0];
    if (!d0) return 0;
    const ANCHOR = new Date(2020, 0, 1);
    return Math.round((d0.getTime() - ANCHOR.getTime()) / 86_400_000);
}

/** Días de trabajo del ciclo genérico para un guardia ocioso (misma lógica que PASO 3 del motor V2). */
export function buildIdleSurplusCycleWorkDays(ctx: V2EngineContext, empId: string): Set<string> {
    const { cL, cF } = pickRepresentativeCycle(ctx.autoCycles ?? ['6+2']);
    const cycleLen = cL + cF;
    const empIndex = ctx.employees.findIndex((e) => e.id === empId);
    const seed = ctx.distributedOffsetSeed ?? 0;

    let offset: number;
    const tw = ctx.prevMonthTrailingWorkDays?.[empId];
    const tr = ctx.prevMonthTrailingRestDays?.[empId];
    if (tw !== undefined && tw > 0) {
        offset = tw % cycleLen;
    } else if (tr !== undefined && tr > 0 && tr < cF) {
        offset = (cL + tr) % cycleLen;
    } else {
        offset = ((empIndex >= 0 ? empIndex : 0) + seed) % cycleLen;
    }

    const start = resolveMonthStartGlobalDayIndex(ctx);
    const work = new Set<string>();
    ctx.daysInMonth.forEach((day, di) => {
        const absDay = start + di;
        const slot = (absDay + offset) % cycleLen;
        if (slot < cL) work.add(ctx.getDateKey(day));
    });
    return work;
}

export function isIdleSurplusEmployee(
    empId: string,
    idleEmployeeIds?: string[],
): boolean {
    return !!idleEmployeeIds?.includes(empId);
}

/** RET solo en días laborables del ciclo; F en francos legales. */
export function surplusStandbyCodeForDay(
    ctx: V2EngineContext,
    empId: string,
    dateStr: string,
): 'RET' | 'F' {
    return buildIdleSurplusCycleWorkDays(ctx, empId).has(dateStr) ? 'RET' : 'F';
}

/** Corrige RET en días de franco del ciclo para guardias del pool stand-by. */
export function enforceSurplusRetCycleOnAssignments(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    _designeeId: string | undefined,
    surplusEmpIds?: string[],
): void {
    const pool = new Set(surplusEmpIds ?? []);
    if (pool.size === 0 && _designeeId) pool.add(_designeeId);
    if (pool.size === 0) return;

    for (const empId of pool) {
        const workDays = buildIdleSurplusCycleWorkDays(ctx, empId);
        for (const a of assignments) {
            if (a.empId !== empId) continue;
            if (String(a.code || '').toUpperCase() !== 'RET') continue;
            if (workDays.has(a.dateStr)) continue;
            a.code = 'F';
            a.name = 'Franco';
            a.hours = 0;
            a.startTime = '00:00';
            a.isFranco = true;
            a.isReten = false;
            a.positionName = '';
        }
    }
}

/** Quita turnos facturables de guardias sin puesto (sobrantes de plantilla). */
export function stripIdleEmployeeBillableAssignments(
    assignments: V2Assignment[],
    empAssignedTo: Record<string, string | null>,
    cycleWorkDays: Record<string, Set<string>>,
    stats?: { totalBillableHours?: number; employeeMonthlyHours?: Record<string, number> },
): void {
    for (const a of assignments) {
        if (empAssignedTo[a.empId] !== null) continue;
        if ((a.hours ?? 0) <= 0) continue;
        const code = String(a.code || '').toUpperCase();
        if (!['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO'].includes(code)) continue;
        const hrs = a.hours ?? 0;
        if (stats?.totalBillableHours != null) stats.totalBillableHours -= hrs;
        if (stats?.employeeMonthlyHours) {
            stats.employeeMonthlyHours[a.empId] = Math.max(0, (stats.employeeMonthlyHours[a.empId] || 0) - hrs);
        }
        const isWork = cycleWorkDays[a.empId]?.has(a.dateStr);
        a.positionName = '';
        a.code = isWork ? 'RET' : 'F';
        a.name = isWork ? 'Retén' : 'Franco';
        a.hours = 0;
        a.startTime = '00:00';
        a.isFranco = !isWork;
        a.isReten = !!isWork;
        delete a.endTime;
    }
}

/** Máximo de RET consecutivos permitido según ciclo (p. ej. 6 en 6+2). */
export function maxConsecutiveRetForCycle(ctx: V2EngineContext): number {
    return pickRepresentativeCycle(ctx.autoCycles ?? ['6+2']).cL;
}

export function maxConsecutiveRetStreak(
    assignments: V2Assignment[],
    empId: string,
    daysInMonth: Date[],
    getDateKey: (d: Date) => string,
): number {
    let max = 0;
    let streak = 0;
    for (const day of daysInMonth) {
        const dateStr = getDateKey(day);
        const cell = assignments.find((a) => a.empId === empId && a.dateStr === dateStr);
        if (String(cell?.code || '').toUpperCase() === 'RET') {
            streak += 1;
            max = Math.max(max, streak);
        } else {
            streak = 0;
        }
    }
    return max;
}
