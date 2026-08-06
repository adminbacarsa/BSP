/**
 * Objetivos mixtos (24 HS + custom): dos pasadas sin mezclar reglas de banda.
 * Fase 1 — puestos 24hs (floater / ciclo 24d).
 * Fase 2 — custom; al fusionar, custom pisa 24hs solo en celdas custom (EN/RO, L–V).
 */

import {
    generateScheduleV2,
    isCustomCoverPosition,
    positionIsActiveOn,
    type V2Assignment,
    type V2EngineContext,
    type V2EmployeeDef,
    type V2GenerateResult,
    type V2GenerateStats,
    type V2PositionDef,
} from './autoScheduleEngineV2';
import { generateScheduleFixedBand } from './fixedBandScheduleEngine';
import {
    canUseFixedBandFloater,
    generateFixedBandFloaterSchedule,
} from './fixedBandFloaterScheduleEngine';
import { allowedPositionNamesForEmp } from './positionAssignmentPolicy';
import { buildObjectiveScheduleProfile } from './objectiveServiceModel';
import { isLabPaddingEmpId } from './objectiveHeadcount';
import { cronogramRulesToEngineFlags, resolveCronogramPlanningRules } from './cronogramPlanningRules';
import { buildPlanningRunPlan24hs } from './planningRunPlan';
import {
    allocate24hsRotationRoster,
    applyPlanningRoster24hsToContext,
} from './planningRoster24hs';

function assignmentKey(a: Pick<V2Assignment, 'empId' | 'dateStr'>): string {
    return `${a.empId}|${a.dateStr}`;
}

function stripLabPaddingFromGroups(groups: Record<string, string[]>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [name, ids] of Object.entries(groups)) {
        out[name] = ids.filter((id) => !isLabPaddingEmpId(id));
    }
    return out;
}

function mergePositionGroups(
    a: Record<string, string[]>,
    b: Record<string, string[]>,
): Record<string, string[]> {
    const out: Record<string, string[]> = stripLabPaddingFromGroups(a);
    for (const [name, ids] of Object.entries(stripLabPaddingFromGroups(b))) {
        const prev = out[name] ?? [];
        out[name] = [...new Set([...prev, ...ids])].filter((id) => !isLabPaddingEmpId(id));
    }
    return out;
}

/** Titulares custom por puesto (solo fase 2 / defaultPosition). */
function resolveCustomTitularByEmp(
    ctx: V2EngineContext,
    customPositions: V2PositionDef[],
): Record<string, string> {
    const defaultPos = {
        ...(ctx.rosterSeedByEmp || {}),
        ...(ctx.defaultPositionByEmp || {}),
    };
    const out: Record<string, string> = {};
    const used = new Set<string>();
    const reals = ctx.employees.filter((e) => !isLabPaddingEmpId(e.id));

    for (const pos of customPositions) {
        if (!isCustomCoverPosition(pos)) continue;
        const posName = pos.positionName;
        const need = Math.max(1, Number(pos.qty) || 1);
        let assigned = 0;

        for (const emp of reals) {
            if (assigned >= need) break;
            if (used.has(emp.id)) continue;
            if (defaultPos[emp.id] !== posName) continue;
            const allowed = allowedPositionNamesForEmp(ctx, emp.id);
            if (allowed?.length && !allowed.includes(posName)) continue;
            out[emp.id] = posName;
            used.add(emp.id);
            assigned += 1;
        }
        for (const emp of reals) {
            if (assigned >= need) break;
            if (used.has(emp.id)) continue;
            const allowed = allowedPositionNamesForEmp(ctx, emp.id);
            if (allowed?.length && !allowed.includes(posName)) continue;
            out[emp.id] = posName;
            used.add(emp.id);
            assigned += 1;
        }
    }
    return out;
}

function customShiftCodesForPosition(pos: V2PositionDef): Set<string> {
    return new Set((pos.shifts || []).map((s) => String(s.code || '').toUpperCase()));
}

/** Solo celdas que realmente cubren el bloque custom (EN/RO), no RET/F del pool. */
function assignmentOverlaysCustomBlock(
    a: Pick<V2Assignment, 'code' | 'positionName'>,
    customPositions: V2PositionDef[],
    customPosNames: Set<string>,
): boolean {
    if (a.positionName && customPosNames.has(a.positionName)) return true;
    const code = String(a.code || '').toUpperCase();
    if (!code || code === 'F' || code === 'FF' || code === 'FP' || code === 'RET' || code === 'REF' || code === 'ESC') {
        return false;
    }
    for (const pos of customPositions) {
        if (customShiftCodesForPosition(pos).has(code)) return true;
    }
    return false;
}

function mergeMixedAssignments(
    phase24: V2Assignment[],
    phaseCustom: V2Assignment[],
    customPositions: V2PositionDef[],
    customTitularByEmp: Record<string, string>,
    ctx: V2EngineContext,
): V2Assignment[] {
    const byKey = new Map<string, V2Assignment>();
    for (const a of phase24) byKey.set(assignmentKey(a), a);

    const customPosNames = new Set(customPositions.map((p) => p.positionName));
    const posByName = new Map(customPositions.map((p) => [p.positionName, p]));

    for (const a of phaseCustom) {
        if (!assignmentOverlaysCustomBlock(a, customPositions, customPosNames)) continue;

        const titularPos = customTitularByEmp[a.empId];
        if (titularPos) {
            const pos = posByName.get(titularPos);
            if (pos) {
                const dayLetter = ctx.getDayLetter(a.dateStr);
                if (!positionIsActiveOn(pos, dayLetter, a.dateStr)) continue;
            }
        }

        byKey.set(assignmentKey(a), a);
    }
    return [...byKey.values()];
}

function mergeGenerateStats(phase24: V2GenerateStats, phaseCustom: V2GenerateStats): V2GenerateStats {
    return {
        ...phaseCustom,
        positionGroups: mergePositionGroups(phase24.positionGroups ?? {}, phaseCustom.positionGroups ?? {}),
        rosterPhasedByKind: true,
        rosterVirtualAssignmentCount:
            (phase24.rosterVirtualAssignmentCount ?? 0) + (phaseCustom.rosterVirtualAssignmentCount ?? 0),
        uncoveredSlots: (phase24.uncoveredSlots ?? 0) + (phaseCustom.uncoveredSlots ?? 0),
        uncoveredSlotsByDay: {
            ...(phase24.uncoveredSlotsByDay ?? {}),
            ...(phaseCustom.uncoveredSlotsByDay ?? {}),
        },
        totalAssignments: phaseCustom.totalAssignments,
        totalBillableHours:
            (phase24.totalBillableHours ?? 0) + (phaseCustom.totalBillableHours ?? 0),
        employeeMonthlyHours: { ...phase24.employeeMonthlyHours, ...phaseCustom.employeeMonthlyHours },
        employeeCycleHours: {
            current: { ...phase24.employeeCycleHours.current, ...phaseCustom.employeeCycleHours.current },
            next: { ...phase24.employeeCycleHours.next, ...phaseCustom.employeeCycleHours.next },
        },
        idleEmployeeIds: phase24.idleEmployeeIds,
        openingSlotByEmp: phase24.openingSlotByEmp,
        primaryShiftByEmp: {
            ...(phase24.primaryShiftByEmp ?? {}),
            ...(phaseCustom.primaryShiftByEmp ?? {}),
        },
        retFloaterEmpIds: phase24.retFloaterEmpIds,
        strandedEmployeeIds: phase24.strandedEmployeeIds,
    };
}

function lockDefaultPositionsFromPhase(
    base: Record<string, string> | undefined,
    phase: V2GenerateResult,
    positionNames: Set<string>,
): Record<string, string> {
    const out: Record<string, string> = { ...(base || {}) };
    for (const [posName, empIds] of Object.entries(phase.stats.positionGroups ?? {})) {
        if (!positionNames.has(posName)) continue;
        for (const empId of empIds) {
            out[empId] = posName;
        }
    }
    return out;
}

function employeesFor24hsRotationPhase(
    ctx: V2EngineContext,
    customPositionNames: Set<string>,
): V2EmployeeDef[] {
    const defaultPos = {
        ...(ctx.rosterSeedByEmp || {}),
        ...(ctx.defaultPositionByEmp || {}),
    };
    return ctx.employees.filter((emp) => {
        const fromDefault = defaultPos[emp.id];
        if (fromDefault && customPositionNames.has(fromDefault)) return false;
        const allowed = allowedPositionNamesForEmp(ctx, emp.id);
        if (allowed?.length && allowed.every((n) => customPositionNames.has(n))) {
            return false;
        }
        return true;
    });
}

function attach24hsRotationRosterForMixedPhase(ctx: V2EngineContext): V2EngineContext {
    const plan = buildPlanningRunPlan24hs(ctx);
    if (!plan) return ctx;
    const roster = allocate24hsRotationRoster(ctx, plan);
    if (!roster.ok) return ctx;
    return applyPlanningRoster24hsToContext(ctx, roster);
}

function generate24hsBlockForMixed(ctx: V2EngineContext): V2GenerateResult {
    const floaterCtx: V2EngineContext = {
        ...ctx,
        rotateShifts: false,
        demandDriven: false,
        autoCycles: ctx.autoCycles?.length ? ctx.autoCycles : ['6+2'],
    };
    const rosterCtx = attach24hsRotationRosterForMixedPhase(floaterCtx);
    if (canUseFixedBandFloater(rosterCtx)) {
        return generateFixedBandFloaterSchedule(rosterCtx);
    }
    const fixed = generateScheduleFixedBand(rosterCtx);
    const gaps = fixed.stats.uncoveredSlots ?? 0;
    if (gaps > 0) {
        const rot = generateScheduleV2({ ...rosterCtx, rotateShifts: true });
        if ((rot.stats.uncoveredSlots ?? gaps) < gaps) return rot;
    }
    return fixed;
}

export function objectiveRequiresMixedSchedulePipeline(positions: V2EngineContext['positions']): boolean {
    return buildObjectiveScheduleProfile(positions).kind === 'mixed';
}

export function generateScheduleMixedObjective(ctx: V2EngineContext): V2GenerateResult {
    try {
        return generateScheduleMixedObjectiveCore(ctx);
    } catch (err) {
        console.error('[mixedSchedule] fallback a pipeline único', err);
        return generateScheduleV2({ ...ctx, _skipMixedPipeline: true });
    }
}

function generateScheduleMixedObjectiveCore(ctx: V2EngineContext): V2GenerateResult {
    const profile = buildObjectiveScheduleProfile(ctx.positions);
    const rules = resolveCronogramPlanningRules(ctx.positions);
    const engineFlags = cronogramRulesToEngineFlags(rules);

    const pos24 = profile.positions24hs;
    const posTail = [...profile.positionsCustom, ...profile.positionsOther];
    if (pos24.length === 0 || posTail.length === 0) {
        return generateScheduleV2({ ...ctx, _skipMixedPipeline: true });
    }

    const pos24Names = new Set(pos24.map((p) => p.positionName));
    const customPosNames = new Set(posTail.map((p) => p.positionName));
    const customTitularByEmp = resolveCustomTitularByEmp(ctx, posTail);
    const titularIds = new Set(Object.keys(customTitularByEmp));
    const employeesPhase24 = employeesFor24hsRotationPhase(ctx, customPosNames);

    const ctxPhase24: V2EngineContext = {
        ...ctx,
        positions: pos24,
        employees: employeesPhase24,
        rotateShifts: false,
        allowCustom24hsBackup: false,
        schedulePhasedRotativeFirst: false,
        preserveRotativeIntegrity: true,
        cronogramRules: rules,
        demandDriven: false,
        _skipMixedPipeline: true,
    };

    const phase24 = generate24hsBlockForMixed(ctxPhase24);

    const lockedPositions = lockDefaultPositionsFromPhase(
        ctx.defaultPositionByEmp,
        phase24,
        pos24Names,
    );

    const defaultForCustomPhase: Record<string, string> = {
        ...(ctx.defaultPositionByEmp || {}),
        ...customTitularByEmp,
    };
    for (const [empId, posName] of Object.entries(lockedPositions)) {
        if (pos24Names.has(posName)) defaultForCustomPhase[empId] = posName;
    }

    const pinnedForCustom = phase24.assignments.filter((a) => {
        if (!titularIds.has(a.empId)) return true;
        const titPos = customTitularByEmp[a.empId];
        const pos = posTail.find((p) => p.positionName === titPos);
        if (!pos) return true;
        const dayLetter = ctx.getDayLetter(a.dateStr);
        return !positionIsActiveOn(pos, dayLetter, a.dateStr);
    });

    const ctxPhaseCustom: V2EngineContext = {
        ...ctx,
        positions: posTail,
        rotateShifts: false,
        allowCustom24hsBackup: false,
        schedulePhasedRotativeFirst: false,
        preserveRotativeIntegrity: false,
        defaultPositionByEmp: defaultForCustomPhase,
        pinnedAssignments: pinnedForCustom,
        cronogramRules: rules,
        headcountByPax: engineFlags.headcountByPax,
        _skipMixedPipeline: true,
    };

    const phaseCustom = generateScheduleV2(ctxPhaseCustom);

    const assignments = mergeMixedAssignments(
        phase24.assignments,
        phaseCustom.assignments,
        posTail,
        customTitularByEmp,
        ctx,
    );

    const stats = mergeGenerateStats(phase24.stats, phaseCustom.stats);
    const totalBillableHours = assignments.reduce((s, a) => s + (Number(a.hours) || 0), 0);

    return {
        ...phaseCustom,
        assignments,
        stats: {
            ...stats,
            totalBillableHours,
            totalAssignments: assignments.length,
        },
    };
}
