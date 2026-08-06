/**
 * Completa dotación 24hs con legajos semi-reales (protocolo lab-pad) antes de plan/roster.
 */

import type { V2EngineContext, V2EmployeeDef } from './autoScheduleEngineV2';
import { applyPlanningDotacionPadding } from './planningPaddingProtocol';
import { buildObjectiveScheduleProfile } from './objectiveServiceModel';

export function pad24hsPlanningEmployeesIfNeeded(ctx: V2EngineContext): {
    ctx: V2EngineContext;
    warnings: string[];
    added: V2EmployeeDef[];
} {
    if (ctx._skipMixedPipeline === true) {
        return { ctx, warnings: [], added: [] };
    }
    if (buildObjectiveScheduleProfile(ctx.positions).kind !== '24hs_only') {
        return { ctx, warnings: [], added: [] };
    }

    const applied = applyPlanningDotacionPadding({
        positions: ctx.positions,
        employees: ctx.employees,
        daysInMonth: ctx.daysInMonth,
        slaVendidas: ctx.slaVendidas,
        absences: ctx.absences,
        empMonthlyInitial: ctx.empMonthlyInitial,
        getDateKey: ctx.getDateKey,
        getDayLetter: ctx.getDayLetter,
        objectiveId: ctx.objectiveId,
        autoCycles: ctx.autoCycles,
        headcountByPax: ctx.headcountByPax ?? true,
    });

    if (applied.report.added.length === 0) {
        return { ctx, warnings: applied.warnings, added: [] };
    }

    return {
        ctx: {
            ...ctx,
            employees: applied.employees,
            empMonthlyInitial: applied.empMonthlyInitial,
            absences: applied.absences,
        },
        warnings: applied.warnings,
        added: applied.report.added,
    };
}
