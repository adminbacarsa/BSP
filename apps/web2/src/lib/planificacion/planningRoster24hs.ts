/**
 * Roster determinístico para objetivos puros 24hs — sin fill-ratio ni excedente implícito.
 */

import type { V2EngineContext } from './autoScheduleEngineV2';
import {
    allowedPositionNamesForEmp,
    empCanCoverPositionShift,
    empHasPositionAssignmentRestriction,
} from './positionAssignmentPolicy';
import { isLabPaddingEmpId } from './objectiveHeadcount';
import type { PlanningRunPlan24hs } from './planningRunPlan';
import { buildPlanningRunPlan24hs } from './planningRunPlan';
import { pad24hsPlanningEmployeesIfNeeded } from './planning24hsPadding';

export type PlanningRoster24hsResult = {
    ok: boolean;
    errors: string[];
    warnings: string[];
    positionGroups: Record<string, string[]>;
    floaters: string[];
    structuralHeadcount: number;
    relocatedEmpIds: string[];
};

function defaultPosMap(ctx: V2EngineContext): Record<string, string> {
    return {
        ...(ctx.rosterSeedByEmp || {}),
        ...(ctx.defaultPositionByEmp || {}),
    };
}

function eligibleEmployeeIds(ctx: V2EngineContext): string[] {
    return ctx.employees.map((e) => e.id);
}

function resolveFixedPosition(
    ctx: V2EngineContext,
    empId: string,
    positionNames: Set<string>,
    defaultPos: Record<string, string>,
): string | undefined {
    const allowed = allowedPositionNamesForEmp(ctx, empId);
    const fromDefault = defaultPos[empId];
    if (fromDefault && positionNames.has(fromDefault)) {
        if (!allowed || allowed.includes(fromDefault)) return fromDefault;
    }
    if (allowed?.length === 1 && positionNames.has(allowed[0]!)) {
        return allowed[0];
    }
    if (allowed && allowed.length > 1) {
        const pick = allowed.find((n) => positionNames.has(n));
        if (pick) return pick;
    }
    if (fromDefault && empHasPositionAssignmentRestriction(ctx, empId)) return undefined;
    return fromDefault && positionNames.has(fromDefault) ? fromDefault : undefined;
}

function sortEmployeesForRoster(ctx: V2EngineContext, empIds: string[]): string[] {
    const meta = (id: string) => ctx.employees.find((e) => e.id === id);
    return [...empIds].sort((a, b) => {
        const synthA = isLabPaddingEmpId(a) ? 1 : 0;
        const synthB = isLabPaddingEmpId(b) ? 1 : 0;
        if (synthA !== synthB) return synthA - synthB;
        const na = meta(a)?.nombre ?? a;
        const nb = meta(b)?.nombre ?? b;
        return na.localeCompare(nb, 'es');
    });
}

/**
 * Asigna legajos a pools de rotación: exactamente `requiredByPosition` por puesto.
 * El resto → floaters (solo si sobran legajos elegibles).
 */
export function allocate24hsRotationRoster(
    ctx: V2EngineContext,
    plan: PlanningRunPlan24hs,
): PlanningRoster24hsResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const relocatedEmpIds: string[] = [];

    const positionNames = new Set(plan.positions.map((p) => p.positionName));
    const positionGroups: Record<string, string[]> = {};
    for (const pos of plan.positions) {
        positionGroups[pos.positionName] = [];
    }

    const defaultPos = defaultPosMap(ctx);
    const eligible = eligibleEmployeeIds(ctx);

    const unassigned: string[] = [];
    for (const empId of eligible) {
        const fixed = resolveFixedPosition(ctx, empId, positionNames, defaultPos);
        if (fixed) {
            positionGroups[fixed].push(empId);
        } else {
            unassigned.push(empId);
        }
    }

    const pullUnassigned = (posName: string): string | undefined => {
        const candidates = sortEmployeesForRoster(
            ctx,
            unassigned.filter((id) => empCanCoverPositionShift(ctx, id, posName, 'M')
                || empCanCoverPositionShift(ctx, id, posName, 'T')
                || empCanCoverPositionShift(ctx, id, posName, 'N')),
        );
        if (candidates.length === 0) return undefined;
        const id = candidates[0]!;
        unassigned.splice(unassigned.indexOf(id), 1);
        return id;
    };

    const rebalanceOne = (defName: string, surName: string): boolean => {
        const src = positionGroups[surName] || [];
        const canMoveToDef = (id: string) =>
            empCanCoverPositionShift(ctx, id, defName, 'M')
            || empCanCoverPositionShift(ctx, id, defName, 'T')
            || empCanCoverPositionShift(ctx, id, defName, 'N');
        let pickIdx = src.findIndex(
            (id) => canMoveToDef(id)
                && !ctx.prevMonthLastShiftByEmp?.[id]
                && ctx.prevMonthOpeningSlotByEmp?.[id] === undefined,
        );
        if (pickIdx < 0) pickIdx = src.findIndex((id) => canMoveToDef(id));
        if (pickIdx < 0) return false;
        const movedId = src.splice(pickIdx, 1)[0];
        positionGroups[defName].push(movedId);
        relocatedEmpIds.push(movedId);
        warnings.push(`Reasignado ${movedId} de «${surName}» a «${defName}» para cerrar cupo de rotación.`);
        return true;
    };

    for (let iter = 0; iter < 500; iter++) {
        let changed = false;
        for (const pos of plan.positions) {
            const need = plan.requiredByPosition[pos.positionName] ?? 0;
            const group = positionGroups[pos.positionName] ?? [];
            while (group.length < need) {
                const id = pullUnassigned(pos.positionName);
                if (id) {
                    group.push(id);
                    changed = true;
                    continue;
                }
                let rebalanced = false;
                for (const donor of plan.positions) {
                    if (donor.positionName === pos.positionName) continue;
                    const dNeed = plan.requiredByPosition[donor.positionName] ?? 0;
                    const dHave = (positionGroups[donor.positionName] ?? []).length;
                    if (dHave <= dNeed) continue;
                    if (rebalanceOne(pos.positionName, donor.positionName)) {
                        rebalanced = true;
                        changed = true;
                        break;
                    }
                }
                if (!rebalanced) break;
            }
        }
        if (!changed) break;
    }

    const floaters: string[] = [...unassigned];
    for (const pos of plan.positions) {
        const need = plan.requiredByPosition[pos.positionName] ?? 0;
        const group = positionGroups[pos.positionName] ?? [];
        while (group.length > need) {
            const withoutContinuity = group.findIndex(
                (id) => !ctx.prevMonthLastShiftByEmp?.[id]
                    && ctx.prevMonthOpeningSlotByEmp?.[id] === undefined,
            );
            const idx = withoutContinuity >= 0 ? withoutContinuity : group.length - 1;
            const [extra] = group.splice(idx, 1);
            floaters.push(extra);
            warnings.push(`«${pos.positionName}»: ${extra} fuera del cupo ${need} → flotante.`);
        }
    }

    for (const pos of plan.positions) {
        const need = plan.requiredByPosition[pos.positionName] ?? 0;
        const have = (positionGroups[pos.positionName] ?? []).length;
        if (have < need) {
            errors.push(
                `«${pos.positionName}»: faltan ${need - have} guardia(s) para rotación `
                + `(necesita ${need}, tiene ${have}). Dotación objetivo: ${plan.structuralHeadcount} legajos.`,
            );
        }
    }

    const assignedCount = plan.positions.reduce(
        (s, p) => s + (positionGroups[p.positionName]?.length ?? 0),
        0,
    );
    if (eligible.length < plan.structuralHeadcount) {
        errors.push(
            `Plantilla insuficiente: ${eligible.length} legajos en objetivo. `
            + `M/T/N requiere ${plan.mtnStructuralHeadcount}; D12+N12 requiere ${plan.h12StructuralHeadcount}.`,
        );
    } else if (assignedCount < plan.structuralHeadcount && errors.length === 0) {
        errors.push(
            `No se pudo completar roster 24hs (${assignedCount}/${plan.structuralHeadcount}). `
            + 'Revisá dotación por puesto en planificación.',
        );
    }

    for (const pos of plan.positions) {
        positionGroups[pos.positionName] = sortEmployeesForRoster(
            ctx,
            positionGroups[pos.positionName] ?? [],
        );
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        positionGroups,
        floaters: sortEmployeesForRoster(ctx, floaters),
        structuralHeadcount: plan.structuralHeadcount,
        relocatedEmpIds,
    };
}

export function applyPlanningRoster24hsToContext(
    ctx: V2EngineContext,
    roster: PlanningRoster24hsResult,
): V2EngineContext {
    if (!roster.ok) return ctx;
    return {
        ...ctx,
        planningRoster24hs: roster,
        idleSurplusEmpIds: roster.floaters,
    };
}

/** Valida roster 24hs con la misma regla que prepare (padding + contingencia D12+N12). */
export function check24hsRotationRosterFeasibility(ctx: V2EngineContext): {
    ok: boolean;
    errors: string[];
    warnings: string[];
    operationalMode?: 'mtn_8h' | 'd12_n12_structural';
} {
    const padded = pad24hsPlanningEmployeesIfNeeded(ctx);
    let workCtx = padded.ctx;
    const warnings: string[] = [...padded.warnings];

    const plan = buildPlanningRunPlan24hs(workCtx);
    if (!plan) {
        return { ok: true, errors: [], warnings };
    }
    if (plan.structuralModo12AllMonth) {
        const allDays = workCtx.daysInMonth.map((d) => workCtx.getDateKey(d));
        workCtx = { ...workCtx, modo12Days: allDays, apretarCronoDays: allDays };
        warnings.push(
            `Roster en contingencia D12+N12 (${plan.structuralHeadcount} legajos; M/T/N pediría ${plan.mtnStructuralHeadcount}).`,
        );
    }
    const roster = allocate24hsRotationRoster(workCtx, plan);
    return {
        ok: roster.ok,
        errors: roster.errors,
        warnings: [...warnings, ...roster.warnings],
        operationalMode: plan.operationalMode,
    };
}
