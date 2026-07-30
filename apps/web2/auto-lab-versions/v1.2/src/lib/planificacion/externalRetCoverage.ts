/**
 * Cobertura con guardias RET de otro objetivo (fuera de plantilla del servicio).
 * Prioridad COSP: Modo 8 plantilla → RET externo + Modo 8 (8h) → extensión 12h → FT.
 */

import type { V2Assignment, V2EngineContext, V2EmployeeDef } from './autoScheduleEngineV2';
import type { AbsenceCoveragePlan, AbsenceCoverageStrategyId } from './absenceCoveragePlanner';
import {
    absenceRequiresCoverage,
    expectedBandForEmployee,
    isWorkBandCode,
} from './absenceFrancoUtils';
import { MODO12_ABSENCE_CODES } from './planningCoveragePolicy';
import { isModo12Day } from './objectiveCoverageDemand';
import { SUVICO_POLICY } from './suvicoPolicy';

export const EXTERNAL_RET_ID_PREFIX = 'lab-ret-ext';

const BANDS_8 = ['M', 'T', 'N'] as const;
const WORK_CODES_8 = new Set<string>(BANDS_8);
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12']);
const NEEDS_EXTERNAL_MODO12 = new Set<AbsenceCoverageStrategyId>([
    'external_ret',
    'blocked_weekly_56',
    'blocked_monthly_200',
    'uncovered',
]);

/** Máximo de guardias RET externos por día (cada uno cubre 1 banda 8h). */
const DEFAULT_EXTERNAL_POOL_SIZE = 1;

const SHIFT_META: Record<string, { name: string; hours: number; startTime: string }> = {
    M: { name: 'Mañana', hours: 8, startTime: '07:00' },
    T: { name: 'Tarde', hours: 8, startTime: '15:00' },
    N: { name: 'Noche', hours: 8, startTime: '23:00' },
    D12: { name: 'Diurno 12h', hours: 12, startTime: '07:00' },
    N12: { name: 'Nocturno 12h', hours: 12, startTime: '19:00' },
};

const WEEKLY_CAP = SUVICO_POLICY.ALERTS.MAX_WEEKLY_BILLABLE_HOURS_WITH_EXTENSION;

export function isExternalRetEmpId(empId: string): boolean {
    return empId.startsWith(EXTERNAL_RET_ID_PREFIX);
}

export function buildExternalRetEmployees(count: number): V2EmployeeDef[] {
    return Array.from({ length: Math.max(0, count) }, (_, i) => ({
        id: `${EXTERNAL_RET_ID_PREFIX}-${String(i + 1).padStart(2, '0')}`,
        nombre: `RET externo ${String(i + 1).padStart(2, '0')}`,
    }));
}

export function shortExternalRetLabel(emp: Pick<V2EmployeeDef, 'id' | 'nombre'>): string {
    if (isExternalRetEmpId(emp.id)) {
        const m = emp.id.match(/(\d+)$/);
        return m ? `RET${Number(m[1])}` : 'RET';
    }
    const n = emp.nombre || emp.id;
    const m = n.match(/(\d+)/);
    return m ? `G${m[1]}` : n.slice(0, 6);
}

export interface Modo8ExternalRetDay {
    dateStr: string;
    positionName: string;
    /** Bandas M/T/N sin cubrir antes de activar RET. */
    bandsToCover: string[];
    /** RET interno de plantilla → banda 8h (sobra capacidad, no es hueco). */
    internalRetAssignments: Array<{ empId: string; band: string }>;
    /** Bandas que cubre RET externo (8h). */
    bandsForExternal: string[];
    absentEmpIds: string[];
}

export interface Modo8ExternalRetPlan {
    /** Días que se cubren con RET externo + M/T/N (sin contingencia D12/N12). */
    modo8Days: Modo8ExternalRetDay[];
    /** dateStr → saltar Modo 12 / split D12+N12. */
    skipModo12Days: Set<string>;
    externalPoolSize: number;
}

export interface ExternalRetAction {
    dateStr: string;
    empId: string;
    band: string;
    positionName: string;
    reason: string;
    modo: 'modo8_internal' | 'modo8_external' | 'modo12';
}

export interface ExternalRetResult {
    assignments: V2Assignment[];
    externalEmployees: V2EmployeeDef[];
    actions: ExternalRetAction[];
    modo8Plan: Modo8ExternalRetPlan;
}

function countBandAtPosition(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    band: string,
): number {
    const b = band.toUpperCase();
    return assignments.filter((a) =>
        a.dateStr === dateStr
        && a.positionName === positionName
        && String(a.code || '').toUpperCase() === b
        && (a.hours ?? 0) > 0
        && !isExternalRetEmpId(a.empId),
    ).length;
}

/** Guardia sobrante en RET ese día, disponible para activación puntual (no en ausencia). */
function pickIdleSurplusRetForBand(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    dateStr: string,
    usedOnDay: Set<string>,
): string | null {
    const pool = ctx.idleSurplusEmpIds ?? [];
    for (const empId of pool) {
        if (usedOnDay.has(empId)) continue;
        if (ctx.absences?.[empId]?.has(dateStr)) continue;
        const cell = assignments.find((a) => a.empId === empId && a.dateStr === dateStr);
        const code = String(cell?.code || '').toUpperCase();
        if (code !== 'RET') continue;
        return empId;
    }
    return null;
}

/**
 * Activa guardias sobrantes (pool RET del objetivo) para cerrar bandas faltantes
 * en todos los puestos, antes de recurrir a RET externo.
 */
export function activateIdleSurplusRetForGaps(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    actions: ExternalRetAction[],
): void {
    const pool = ctx.idleSurplusEmpIds ?? [];
    if (pool.length === 0) return;

    const usedByDay = new Map<string, Set<string>>();

    for (const day of ctx.daysInMonth) {
        const dateStr = ctx.getDateKey(day);
        const modo12 = isModo12Day(dateStr, ctx);
        const bands = modo12 ? (['D12', 'N12'] as const) : (['M', 'T', 'N'] as const);
        const usedOnDay = usedByDay.get(dateStr) ?? new Set<string>();
        usedByDay.set(dateStr, usedOnDay);

        for (const pos of ctx.positions) {
            const positionName = pos.positionName;
            const pax = Math.max(1, Number(pos.qty) || 1);
            for (const band of bands) {
                const have = countBandAtPosition(assignments, dateStr, positionName, band);
                if (have >= pax) continue;

                const surplus = pickIdleSurplusRetForBand(ctx, assignments, dateStr, usedOnDay);
                if (!surplus) break;

                assignWorkShift(assignments, surplus, dateStr, band, positionName);
                usedOnDay.add(surplus);
                actions.push({
                    dateStr,
                    empId: surplus,
                    band,
                    positionName,
                    reason: 'surplus_ret:activacion',
                    modo: modo12 ? 'modo12' : 'modo8_internal',
                });
            }
        }
    }
}

function positionPax(ctx: V2EngineContext, positionName: string): number {
    const pos = ctx.positions.find((p) => p.positionName === positionName);
    return Math.max(1, Number(pos?.qty) || 1);
}

function empBelongsToPosition(ctx: V2EngineContext, empId: string, positionName: string): boolean {
    const assigned = ctx.defaultPositionByEmp?.[empId] ?? ctx.rosterSeedByEmp?.[empId];
    if (assigned) return assigned === positionName;
    return ctx.positions.length === 1 && ctx.positions[0]?.positionName === positionName;
}

function analyzeModo8Capacity(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    dateStr: string,
    positionName: string,
    openingSlotByEmp?: Record<string, number>,
): { bandCounts: Record<string, number>; missing: string[]; internalRetEmpIds: string[] } {
    const pax = positionPax(ctx, positionName);
    const bandCounts: Record<string, number> = { M: 0, T: 0, N: 0 };
    const internalRetEmpIds: string[] = [];
    const absentIds = new Set<string>();

    for (const [empId, dateMap] of Object.entries(ctx.absences ?? {})) {
        if (dateMap.has(dateStr)) absentIds.add(empId);
    }

    for (const emp of ctx.employees) {
        if (isExternalRetEmpId(emp.id) || absentIds.has(emp.id)) continue;
        const isSurplusStandby = ctx.idleSurplusEmpIds?.includes(emp.id);
        if (!empBelongsToPosition(ctx, emp.id, positionName) && !isSurplusStandby) continue;

        const cell = assignments.find((a) => a.empId === emp.id && a.dateStr === dateStr);
        const code = String(cell?.code || '').toUpperCase();

        if (WORK_CODES_8.has(code) && cell?.positionName === positionName) {
            bandCounts[code] = (bandCounts[code] || 0) + 1;
            continue;
        }

        if (code === 'RET' || (cell?.isReten === true && !WORK_CODES_8.has(code))) {
            internalRetEmpIds.push(emp.id);
            continue;
        }

        if (code === 'F' || code === 'FF' || code === 'FP') {
            continue;
        }

        if (!cell && openingSlotByEmp) {
            const band = expectedBandForEmployee(
                emp.id,
                dateStr,
                openingSlotByEmp,
                ctx.daysInMonth,
                ctx.getDateKey,
                ctx,
            );
            if (band === 'F') continue;
            if (isWorkBandCode(band) && WORK_CODES_8.has(band!)) {
                bandCounts[band!] = (bandCounts[band!] || 0) + 1;
            }
        }
    }

    const missing: string[] = [];
    for (const band of BANDS_8) {
        const gap = Math.max(0, pax - (bandCounts[band] || 0));
        for (let i = 0; i < gap; i++) missing.push(band);
    }

    return { bandCounts, missing, internalRetEmpIds };
}

/** Bandas M/T/N faltantes en un puesto (respeta pax). */
export function countMissingBands8h(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    dateStr: string,
    positionName: string,
    openingSlotByEmp?: Record<string, number>,
): string[] {
    return analyzeModo8Capacity(assignments, ctx, dateStr, positionName, openingSlotByEmp).missing;
}

/**
 * Ante V/L/E: si RET interno + RET externo alcanzan las bandas faltantes → Modo 8 (sin D12/N12).
 * RET en plantilla = capacidad disponible, no hueco SLA.
 */
export function computeModo8ExternalRetPlan(params: {
    ctx: V2EngineContext;
    assignments: V2Assignment[];
    openingSlotByEmp?: Record<string, number>;
    externalPoolSize?: number;
}): Modo8ExternalRetPlan {
    const { ctx, assignments, openingSlotByEmp } = params;
    const poolSize = params.externalPoolSize ?? DEFAULT_EXTERNAL_POOL_SIZE;
    const modo8Days: Modo8ExternalRetDay[] = [];
    const skipModo12Days = new Set<string>();
    const externalBandsPerDay = new Map<string, number>();
    const absenceDates = new Set<string>();

    for (const [, dateMap] of Object.entries(ctx.absences ?? {})) {
        for (const [dateStr, code] of dateMap.entries()) {
            if (MODO12_ABSENCE_CODES.has(String(code || '').toUpperCase())) {
                absenceDates.add(dateStr);
            }
        }
    }

    for (const dateStr of [...absenceDates].sort()) {
        for (const pos of ctx.positions) {
            const positionName = pos.positionName;
            const absentEmpIds: string[] = [];
            for (const [empId, dateMap] of Object.entries(ctx.absences ?? {})) {
                const code = dateMap.get(dateStr);
                if (code && MODO12_ABSENCE_CODES.has(String(code).toUpperCase())) {
                    if (
                        absenceRequiresCoverage(empId, dateStr, openingSlotByEmp, ctx)
                        && empBelongsToPosition(ctx, empId, positionName)
                    ) {
                        absentEmpIds.push(empId);
                    }
                }
            }
            if (absentEmpIds.length === 0) continue;

            const { missing, internalRetEmpIds } = analyzeModo8Capacity(
                assignments,
                ctx,
                dateStr,
                positionName,
                openingSlotByEmp,
            );

            if (missing.length === 0) continue;

            const surplusStandby = (ctx.idleSurplusEmpIds ?? []).filter(
                (id) => !absentEmpIds.includes(id) && !ctx.absences?.[id]?.has(dateStr),
            );
            const internalCapacity: string[] = [...internalRetEmpIds];
            for (const id of surplusStandby) {
                if (!internalCapacity.includes(id)) internalCapacity.push(id);
            }

            const deployable = internalCapacity.length + poolSize;
            if (missing.length > deployable) continue;

            const internalRetAssignments: Array<{ empId: string; band: string }> = [];
            const bandsForExternal: string[] = [];

            for (let i = 0; i < missing.length; i++) {
                const band = missing[i];
                if (i < internalCapacity.length) {
                    internalRetAssignments.push({ empId: internalCapacity[i], band });
                } else {
                    bandsForExternal.push(band);
                }
            }

            modo8Days.push({
                dateStr,
                positionName,
                bandsToCover: missing,
                internalRetAssignments,
                bandsForExternal,
                absentEmpIds,
            });
            skipModo12Days.add(dateStr);
            externalBandsPerDay.set(
                dateStr,
                (externalBandsPerDay.get(dateStr) || 0) + bandsForExternal.length,
            );
        }
    }

    const maxExternalBandsSameDay = externalBandsPerDay.size > 0
        ? Math.max(...externalBandsPerDay.values())
        : 0;

    return {
        modo8Days,
        skipModo12Days,
        externalPoolSize: maxExternalBandsSameDay > 0 ? Math.max(poolSize, maxExternalBandsSameDay) : 0,
    };
}

function revertInternalToStandby(
    cell: V2Assignment,
    empId: string,
    dateStr: string,
    openingSlotByEmp: Record<string, number> | undefined,
    ctx: V2EngineContext,
): void {
    if (openingSlotByEmp) {
        const band = expectedBandForEmployee(
            empId,
            dateStr,
            openingSlotByEmp,
            ctx.daysInMonth,
            ctx.getDateKey,
            ctx,
        );
        if (band === 'F') {
            cell.code = 'F';
            cell.name = 'Franco';
            cell.hours = 0;
            cell.startTime = '00:00';
            cell.isFranco = true;
            cell.isReten = false;
            cell.positionName = '';
            return;
        }
    }
    cell.code = 'RET';
    cell.name = 'Retén';
    cell.hours = 0;
    cell.startTime = '00:00';
    cell.isFranco = false;
    cell.isReten = true;
    cell.positionName = '';
}

function assignWorkShift(
    assignments: V2Assignment[],
    empId: string,
    dateStr: string,
    code: string,
    positionName: string,
): void {
    const meta = SHIFT_META[code] || { name: code, hours: 8, startTime: '07:00' };
    const existing = assignments.find((a) => a.empId === empId && a.dateStr === dateStr);
    if (existing) {
        existing.code = code;
        existing.name = meta.name;
        existing.hours = meta.hours;
        existing.startTime = meta.startTime;
        existing.isFranco = false;
        existing.isReten = false;
        existing.positionName = positionName;
        return;
    }
    assignments.push({
        empId,
        dateStr,
        positionName,
        code,
        name: meta.name,
        hours: meta.hours,
        startTime: meta.startTime,
        isFranco: false,
        isReten: false,
    });
}

/** Revierte D12/N12 a M/N en días Modo 8 (por si el cronograma base ya los tenía). */
function ensureInternalBands8h(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
): void {
    for (const a of assignments) {
        if (a.dateStr !== dateStr || isExternalRetEmpId(a.empId)) continue;
        if (positionName && a.positionName && a.positionName !== positionName) continue;
        const c = String(a.code || '').toUpperCase();
        if (c === 'D12') {
            assignWorkShift(assignments, a.empId, dateStr, 'M', positionName || a.positionName);
        } else if (c === 'N12') {
            assignWorkShift(assignments, a.empId, dateStr, 'N', positionName || a.positionName);
        }
    }
}

function bandsToOffloadModo12(planDay: AbsenceCoveragePlan['days'][number]): string[] {
    if (planDay.externalRetBands.length > 0) {
        return [...planDay.externalRetBands];
    }
    if (planDay.strategy === 'blocked_weekly_56' || planDay.strategy === 'blocked_monthly_200') {
        const overflow = planDay.coverers
            .filter((c) => (planDay.weeklyHoursByEmp[c.empId] ?? 0) > WEEKLY_CAP)
            .sort(
                (a, b) =>
                    (planDay.weeklyHoursByEmp[b.empId] ?? 0)
                    - (planDay.weeklyHoursByEmp[a.empId] ?? 0),
            );
        if (overflow.length > 0) return overflow.map((c) => c.code);
        const preferN12 = planDay.coverers.find((c) => c.code === 'N12');
        if (preferN12) return [preferN12.code];
        if (planDay.coverers.length > 0) {
            return [planDay.coverers[planDay.coverers.length - 1].code];
        }
    }
    if (planDay.strategy === 'uncovered') return ['M'];
    return [];
}

function pickExternalForDay(
    pool: V2EmployeeDef[],
    dateStr: string,
    assignments: V2Assignment[],
    usedOnDay: Set<string>,
): V2EmployeeDef | null {
    for (const emp of pool) {
        if (usedOnDay.has(emp.id)) continue;
        const cell = assignments.find((a) => a.empId === emp.id && a.dateStr === dateStr);
        const c = String(cell?.code || '').toUpperCase();
        if (!cell || c === 'RET' || !WORK_CODES.has(c)) {
            return emp;
        }
    }
    return null;
}

export function fillExternalRetStandby(
    assignments: V2Assignment[],
    _ctx: V2EngineContext,
    _externalEmployees: V2EmployeeDef[],
): V2Assignment[] {
    // RET externo: solo turnos M/T/N puntuales ya asignados; sin relleno mensual stand-by.
    return assignments;
}

function applyModo8Coverage(
    result: V2Assignment[],
    modo8Plan: Modo8ExternalRetPlan,
    externalEmployees: V2EmployeeDef[],
    actions: ExternalRetAction[],
): void {
    for (const day of modo8Plan.modo8Days) {
        ensureInternalBands8h(result, day.dateStr, day.positionName);
        const usedExternalOnDay = new Set<string>();

        for (const { empId, band } of day.internalRetAssignments) {
            assignWorkShift(result, empId, day.dateStr, band, day.positionName);
            actions.push({
                dateStr: day.dateStr,
                empId,
                band,
                positionName: day.positionName,
                reason: 'modo8_ret_interno',
                modo: 'modo8_internal',
            });
        }

        for (const band of day.bandsForExternal) {
            const external = pickExternalForDay(externalEmployees, day.dateStr, result, usedExternalOnDay);
            if (!external) continue;

            assignWorkShift(result, external.id, day.dateStr, band, day.positionName);
            usedExternalOnDay.add(external.id);

            actions.push({
                dateStr: day.dateStr,
                empId: external.id,
                band,
                positionName: day.positionName,
                reason: 'modo8_ret_externo',
                modo: 'modo8_external',
            });
        }
    }
}

function applyModo12ExternalRet(
    result: V2Assignment[],
    plan: AbsenceCoveragePlan,
    externalEmployees: V2EmployeeDef[],
    openingSlotByEmp: Record<string, number> | undefined,
    ctx: V2EngineContext,
    actions: ExternalRetAction[],
    skipModo12Days: Set<string>,
): void {
    const positionName = ctx.positions[0]?.positionName || '';

    for (const day of plan.days) {
        if (skipModo12Days.has(day.dateStr)) continue;
        if (!NEEDS_EXTERNAL_MODO12.has(day.strategy)) continue;

        const bands = bandsToOffloadModo12(day);
        if (bands.length === 0) continue;

        const usedOnDay = new Set<string>();

        for (const band of bands) {
            const covered = countBandAtPosition(result, day.dateStr, positionName, band) > 0;
            if (covered) continue;

            const surplus = pickIdleSurplusRetForBand(ctx, result, day.dateStr, usedOnDay);
            if (surplus) {
                assignWorkShift(result, surplus, day.dateStr, band, positionName);
                usedOnDay.add(surplus);
                actions.push({
                    dateStr: day.dateStr,
                    empId: surplus,
                    band,
                    positionName,
                    reason: 'surplus_ret:modo12',
                    modo: 'modo12',
                });
                continue;
            }

            const internal = result.find(
                (a) =>
                    a.dateStr === day.dateStr
                    && (!positionName || a.positionName === positionName)
                    && String(a.code || '').toUpperCase() === band
                    && !isExternalRetEmpId(a.empId),
            );

            const external = pickExternalForDay(externalEmployees, day.dateStr, result, usedOnDay);
            if (!external) continue;

            if (internal) {
                revertInternalToStandby(internal, internal.empId, day.dateStr, openingSlotByEmp, ctx);
            }

            assignWorkShift(result, external.id, day.dateStr, band, positionName);
            usedOnDay.add(external.id);

            actions.push({
                dateStr: day.dateStr,
                empId: external.id,
                band,
                positionName,
                reason: internal ? day.strategy : `${day.strategy}:banda_faltante`,
                modo: 'modo12',
            });
        }
    }
}

export function applyExternalRetCoverage(params: {
    assignments: V2Assignment[];
    ctx: V2EngineContext;
    modo8Plan: Modo8ExternalRetPlan;
    plan?: AbsenceCoveragePlan;
    openingSlotByEmp?: Record<string, number>;
}): ExternalRetResult {
    const { assignments: input, ctx, modo8Plan, plan, openingSlotByEmp } = params;
    const result = input.map((a) => ({ ...a }));
    const actions: ExternalRetAction[] = [];

    const needsModo12External = plan?.needsExternalRet
        && plan.days.some(
            (d) => NEEDS_EXTERNAL_MODO12.has(d.strategy) && !modo8Plan.skipModo12Days.has(d.dateStr),
        );

    const bandsForExternalTotal = modo8Plan.modo8Days.reduce(
        (n, d) => n + d.bandsForExternal.length,
        0,
    );
    const surplusAvailable = (ctx.idleSurplusEmpIds?.length ?? 0) > 0;
    const needsModo12ExternalEffective = needsModo12External && !surplusAvailable;
    const externalCount = bandsForExternalTotal > 0 || needsModo12ExternalEffective
        ? Math.max(modo8Plan.externalPoolSize, needsModo12ExternalEffective ? 1 : 0)
        : 0;

    if (modo8Plan.modo8Days.length === 0 && externalCount === 0) {
        return {
            assignments: result,
            externalEmployees: [],
            actions,
            modo8Plan,
        };
    }

    const externalEmployees = externalCount > 0
        ? buildExternalRetEmployees(externalCount)
        : [];

    applyModo8Coverage(result, modo8Plan, externalEmployees, actions);

    if ((ctx.idleSurplusEmpIds?.length ?? 0) === 0) {
        activateIdleSurplusRetForGaps(result, ctx, actions);
    }

    if (plan && needsModo12ExternalEffective) {
        applyModo12ExternalRet(
            result,
            plan,
            externalEmployees,
            openingSlotByEmp,
            ctx,
            actions,
            modo8Plan.skipModo12Days,
        );
    }

    const filled = fillExternalRetStandby(result, ctx, externalEmployees);

    return {
        assignments: filled,
        externalEmployees,
        actions,
        modo8Plan,
    };
}

export function extendCtxWithExternalRet(
    ctx: V2EngineContext,
    externalEmployees: V2EmployeeDef[],
): V2EngineContext {
    if (externalEmployees.length === 0) return ctx;

    const positionName = ctx.positions[0]?.positionName || '';
    const defaultPositionByEmp = { ...(ctx.defaultPositionByEmp || {}) };
    const empMonthlyInitial = { ...ctx.empMonthlyInitial };

    for (const emp of externalEmployees) {
        defaultPositionByEmp[emp.id] = positionName;
        empMonthlyInitial[emp.id] = 0;
    }

    return {
        ...ctx,
        employees: [...ctx.employees, ...externalEmployees],
        defaultPositionByEmp,
        empMonthlyInitial,
        globalRetPool: [
            ...(ctx.globalRetPool || []),
            ...externalEmployees.map((e) => ({ id: e.id, nombre: e.nombre })),
        ],
        allowFrancoWorkedRescue: false,
    };
}

/**
 * Paso ② de política: RET externo solo para huecos residuales tras agotar excedente interno.
 */
export function applyResidualExternalRetForGaps(params: {
    assignments: V2Assignment[];
    ctx: V2EngineContext;
    underGaps: import('./coveragePolicyBalance').CoverageSlotImbalance[];
    surplusPool: string[];
}): ExternalRetResult {
    const result = params.assignments.map((a) => ({ ...a }));
    const actions: ExternalRetAction[] = [];
    const externalEmployees: V2EmployeeDef[] = [];
    let extIdx = 0;

    const sorted = [...params.underGaps].sort((a, b) => {
        if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr);
        return a.shiftCode.localeCompare(b.shiftCode);
    });

    for (const gap of sorted) {
        const need = Math.abs(gap.delta);
        if (need <= 0) continue;

        for (let i = 0; i < need; i++) {
            let external = externalEmployees[extIdx];
            if (!external) {
                const built = buildExternalRetEmployees(extIdx + 1);
                external = built[extIdx];
                externalEmployees.push(external);
            }
            extIdx += 1;
            const band = gap.shiftCode.toUpperCase();
            assignWorkShift(result, external.id, gap.dateStr, band, gap.positionName);
            actions.push({
                dateStr: gap.dateStr,
                empId: external.id,
                band,
                positionName: gap.positionName,
                reason: 'residual_gap:excedente_agotado',
                modo: 'modo8',
            });
        }
    }

    const filled = fillExternalRetStandby(result, params.ctx, externalEmployees);

    return {
        assignments: filled,
        externalEmployees,
        actions,
        modo8Plan: {
            modo8Days: [],
            skipModo12Days: new Set(),
            externalPoolSize: externalEmployees.length,
            externalBandsPerDay: new Map(),
        },
    };
}
