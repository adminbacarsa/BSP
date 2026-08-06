/**
 * Orquestación planificación puro 24hs (plan + roster + motor).
 */

import type { V2EngineContext } from './autoScheduleEngineV2';
import { pad24hsPlanningEmployeesIfNeeded } from './planning24hsPadding';
import { buildPlanningRunPlan24hs } from './planningRunPlan';
import {
    allocate24hsRotationRoster,
    applyPlanningRoster24hsToContext,
    type PlanningRoster24hsResult,
} from './planningRoster24hs';

export { pad24hsPlanningEmployeesIfNeeded } from './planning24hsPadding';

export type Prepare24hsPlanningContextResult =
    | { ok: true; ctx: V2EngineContext; roster: PlanningRoster24hsResult; warnings: string[] }
    | { ok: false; errors: string[]; warnings: string[] };

function applyStructuralModo12ToCtx(ctx: V2EngineContext): V2EngineContext {
    const allDays = ctx.daysInMonth.map((d) => ctx.getDateKey(d));
    return {
        ...ctx,
        modo12Days: allDays,
        apretarCronoDays: allDays,
    };
}

/**
 * Si el objetivo es puro 24hs, fija roster antes del floater.
 * Otros perfiles: devuelve ctx sin cambios (ok: true, roster vacío sintético).
 */
export function prepare24hsPlanningContext(ctx: V2EngineContext): Prepare24hsPlanningContextResult {
    const padded = pad24hsPlanningEmployeesIfNeeded(ctx);
    let workCtx = padded.ctx;
    const warnings: string[] = [...padded.warnings];

    const plan = buildPlanningRunPlan24hs(workCtx);
    if (!plan) {
        return {
            ok: true,
            ctx: workCtx,
            roster: {
                ok: true,
                errors: [],
                warnings: [],
                positionGroups: {},
                floaters: [],
                structuralHeadcount: 0,
                relocatedEmpIds: [],
            },
            warnings,
        };
    }

    if (plan.structuralModo12AllMonth) {
        workCtx = applyStructuralModo12ToCtx(workCtx);
        warnings.push(
            `Contingencia estructural D12+N12 (mes completo): ${workCtx.employees.length} legajos `
            + `< ${plan.mtnStructuralHeadcount} para M/T/N. Rotación con ${plan.structuralHeadcount} guardias `
            + '(3 por puesto).',
        );
    }

    const roster = allocate24hsRotationRoster(workCtx, plan);
    if (!roster.ok) {
        return { ok: false, errors: roster.errors, warnings: [...warnings, ...roster.warnings] };
    }

    let outCtx = applyPlanningRoster24hsToContext(workCtx, roster);
    if (plan.structuralModo12AllMonth) {
        outCtx = applyStructuralModo12ToCtx(outCtx);
    }

    return {
        ok: true,
        ctx: outCtx,
        roster,
        warnings: [...warnings, ...roster.warnings],
    };
}
