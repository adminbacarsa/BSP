/**
 * Motor V4 — enruta según modo:
 * - rotateShifts=false → bandas fijas (búsqueda de fase hasta cerrar SLA)
 * - rotateShifts=true  → V2 demand-driven rotativo
 */
import {
    generateScheduleV2,
    runAutoScheduleV2,
    pickOptimalAutoCycles,
    effectiveShiftsForPositionDay,
    positionIsActiveOn,
    checkFeasibility,
    pickRepresentativeCycle,
    TARGET_AVG_HOURS,
    HARD_MAX_HOURS,
    type V2EngineContext,
    type V2GenerateResult,
} from './autoScheduleEngineV2';
import { generateScheduleFixedBand } from './fixedBandScheduleEngine';
import {
    generateScheduleMixedObjective,
    objectiveRequiresMixedSchedulePipeline,
} from './mixedScheduleEngine';

function ctxHas24hs(ctx: V2EngineContext): boolean {
    return ctx.positions.some(p => {
        const cov = String(p.coverageType || '').toLowerCase();
        return cov === '24hs' || cov === '24' || cov === '24h';
    });
}

export function generateScheduleV4(ctx: V2EngineContext): V2GenerateResult {
    if (!ctx._skipMixedPipeline && objectiveRequiresMixedSchedulePipeline(ctx.positions)) {
        return generateScheduleMixedObjective(ctx);
    }
    if (ctx.rotateShifts === false) {
        const fixed = generateScheduleFixedBand(ctx);
        const gaps = fixed.stats.uncoveredSlots ?? 0;
        if (gaps > 0 && ctxHas24hs(ctx)) {
            const rot = generateScheduleV2({ ...ctx, rotateShifts: true });
            if ((rot.stats.uncoveredSlots ?? gaps) < gaps) return rot;
        }
        return fixed;
    }
    return generateScheduleV2(ctx);
}

export {
    runAutoScheduleV2 as runAutoScheduleV4,
    pickOptimalAutoCycles,
    effectiveShiftsForPositionDay,
    positionIsActiveOn,
    checkFeasibility,
    pickRepresentativeCycle,
    TARGET_AVG_HOURS,
    HARD_MAX_HOURS,
};

export type {
    V2ShiftDef,
    V2PositionDef,
    V2EmployeeDef,
    V2AbsenceMap,
    V2BudgetMode,
    V2EngineContext,
    V2PositionDemand,
    V2EmployeeOffer,
    V2FeasibilityReport,
    V2EngineResult,
    V2Assignment,
    V2GenerateStats,
    CapOverflowSlot,
    V2GenerateResult,
} from './autoScheduleEngineV2';
