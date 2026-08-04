/**
 * Objetivos mixtos (24 HS + custom): dos pasadas de generación sin mezclar reglas de banda.
 * Fase 1 — solo puestos 24hs (rotación / ciclo).
 * Fase 2 — solo custom (+ otros), con asignaciones de fase 1 fijadas (`pinnedAssignments`).
 */

import {
    generateScheduleV2,
    type V2Assignment,
    type V2EngineContext,
    type V2GenerateResult,
    type V2GenerateStats,
} from './autoScheduleEngineV2';
import { buildObjectiveScheduleProfile } from './objectiveServiceModel';
import { cronogramRulesToEngineFlags, resolveCronogramPlanningRules } from './cronogramPlanningRules';

function assignmentKey(a: Pick<V2Assignment, 'empId' | 'dateStr'>): string {
    return `${a.empId}|${a.dateStr}`;
}

function mergePositionGroups(
    a: Record<string, string[]>,
    b: Record<string, string[]>,
): Record<string, string[]> {
    const out: Record<string, string[]> = { ...a };
    for (const [name, ids] of Object.entries(b)) {
        const prev = out[name] ?? [];
        const merged = [...new Set([...prev, ...ids])];
        out[name] = merged;
    }
    return out;
}

function mergeGenerateStats(phase24: V2GenerateStats, phaseCustom: V2GenerateStats): V2GenerateStats {
    return {
        ...phaseCustom,
        positionGroups: mergePositionGroups(phase24.positionGroups, phaseCustom.positionGroups),
        rosterPhasedByKind: true,
        rosterVirtualAssignmentCount:
            (phase24.rosterVirtualAssignmentCount ?? 0) + (phaseCustom.rosterVirtualAssignmentCount ?? 0),
        uncoveredSlots: (phase24.uncoveredSlots ?? 0) + (phaseCustom.uncoveredSlots ?? 0),
        uncoveredSlotsByDay: {
            ...(phase24.uncoveredSlotsByDay ?? {}),
            ...(phaseCustom.uncoveredSlotsByDay ?? {}),
        },
        totalAssignments: phaseCustom.totalAssignments,
        totalBillableHours: phaseCustom.totalBillableHours,
        employeeMonthlyHours: { ...phase24.employeeMonthlyHours, ...phaseCustom.employeeMonthlyHours },
        employeeCycleHours: {
            current: { ...phase24.employeeCycleHours.current, ...phaseCustom.employeeCycleHours.current },
            next: { ...phase24.employeeCycleHours.next, ...phaseCustom.employeeCycleHours.next },
        },
        idleEmployeeIds: phaseCustom.idleEmployeeIds,
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

export function objectiveRequiresMixedSchedulePipeline(positions: V2EngineContext['positions']): boolean {
    return buildObjectiveScheduleProfile(positions).kind === 'mixed';
}

/**
 * Generación en dos fases para cronogramas mixtos.
 * No invocar si el objetivo no es mixto (delegar en generateScheduleV2).
 */
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

    const ctxPhase24: V2EngineContext = {
        ...ctx,
        positions: pos24,
        rotateShifts: rules.generation.allowGlobalRotateShifts ? ctx.rotateShifts : false,
        allowCustom24hsBackup: false,
        schedulePhasedRotativeFirst: false,
        preserveRotativeIntegrity: true,
        cronogramRules: rules,
        _skipMixedPipeline: true,
    };

    const phase24 = generateScheduleV2(ctxPhase24);

    const lockedPositions = lockDefaultPositionsFromPhase(
        ctx.defaultPositionByEmp,
        phase24,
        pos24Names,
    );

    const customPosNames = new Set(posTail.map((p) => p.positionName));
    const defaultForCustomPhase: Record<string, string> = { ...(ctx.defaultPositionByEmp || {}) };
    for (const [empId, posName] of Object.entries(lockedPositions)) {
        if (customPosNames.has(posName)) defaultForCustomPhase[empId] = posName;
    }

    const ctxPhaseCustom: V2EngineContext = {
        ...ctx,
        positions: posTail,
        rotateShifts: false,
        allowCustom24hsBackup: false,
        schedulePhasedRotativeFirst: false,
        preserveRotativeIntegrity: false,
        defaultPositionByEmp: defaultForCustomPhase,
        pinnedAssignments: phase24.assignments,
        cronogramRules: rules,
        headcountByPax: engineFlags.headcountByPax,
        _skipMixedPipeline: true,
    };

    const phaseCustom = generateScheduleV2(ctxPhaseCustom);

    const seen = new Set<string>();
    const assignments: V2Assignment[] = [];
    for (const a of [...phase24.assignments, ...phaseCustom.assignments]) {
        const k = assignmentKey(a);
        if (seen.has(k)) continue;
        seen.add(k);
        assignments.push(a);
    }

    return {
        ...phaseCustom,
        assignments,
        stats: mergeGenerateStats(phase24.stats, phaseCustom.stats),
    };
}
