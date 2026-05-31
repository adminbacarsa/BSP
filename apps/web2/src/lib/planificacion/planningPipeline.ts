/**
 * Orquestación planificador — etapas separadas (ciclo vs cobertura).
 *
 * A1) 6+1 bandas fijas (6 guardias × puesto 24hs, ratio 85.7 %)
 * A2) 6+2 bandas fijas + flotante (4-5 guardias × puesto 24hs, ratio 75 %)
 * B)  verifyScheduleCoverage — verificación pura (sin fix)
 */

import {
    verifyScheduleCoverage,
    type CoverageVerificationOptions,
    type CoverageVerificationReport,
} from './coverageVerification';
import type { V2EngineContext, V2GenerateResult } from './autoScheduleEngineV2';
import {
    canUseFixedBandFloater,
    generateFixedBandFloaterSchedule,
} from './fixedBandFloaterScheduleEngine';
import {
    canUseSixPlusOne,
    generateSixPlusOneSchedule,
} from './sixPlusOneEngine';

export type StrictSixTwoPipelineResult = {
    pipeline: 'fixedBandFloater' | 'sixPlusOne';
    generation: V2GenerateResult;
    verification: CoverageVerificationReport;
};

export type StrictSixTwoPipelineOptions = CoverageVerificationOptions;

/** Pipeline 6+1: 6 guardias × puesto 24hs, 2 por banda, francos desfasados. */
export function runSixPlusOnePipeline(
    ctx: V2EngineContext,
    verifyOptions?: StrictSixTwoPipelineOptions,
): StrictSixTwoPipelineResult {
    if (!canUseSixPlusOne(ctx)) {
        throw new Error('sixPlusOne: layout inválido (requiere 6 guardias × puesto 24hs qty=1)');
    }
    const generation = generateSixPlusOneSchedule(ctx);
    const verification = verifyScheduleCoverage(
        ctx,
        generation.assignments,
        generation.stats,
        { inferModo12TCoverage: false, ...verifyOptions },
    );
    return { pipeline: 'sixPlusOne', generation, verification };
}

/** Pipeline 6+2: cuarteto M/T/N/flotante y verificación sin parches. */
export function runStrictSixTwoPipeline(
    ctx: V2EngineContext,
    verifyOptions?: StrictSixTwoPipelineOptions,
): StrictSixTwoPipelineResult {
    if (!canUseFixedBandFloater(ctx)) {
        throw new Error('fixedBandFloater: layout inválido (requiere 4 guardias × puesto 24hs qty=1)');
    }
    const generation = generateFixedBandFloaterSchedule({
        ...ctx,
        rotateShifts: false,
        demandDriven: false,
        autoCycles: ctx.autoCycles?.length ? ctx.autoCycles : ['6+2'],
    });
    const verification = verifyScheduleCoverage(
        ctx,
        generation.assignments,
        generation.stats,
        { inferModo12TCoverage: false, ...verifyOptions },
    );
    return { pipeline: 'fixedBandFloater', generation, verification };
}

/** @deprecated Usar runStrictSixTwoPipeline */
export const runCycleBasePipeline = runStrictSixTwoPipeline;
export type CycleBasePipelineResult = StrictSixTwoPipelineResult;
export type CycleBasePipelineOptions = StrictSixTwoPipelineOptions;
