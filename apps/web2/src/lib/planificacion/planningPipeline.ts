/**
 * Orquestación planificador — etapas separadas (ciclo vs cobertura).
 *
 * A1) Banda par genérico (5+1 / 6+1): 6 guardias × puesto 24hs, 2 por banda
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
    canUseBandPairCycle,
    generateBandPairSchedule,
    type BandPairCycle,
} from './bandPairEngine';

export type StrictSixTwoPipelineResult = {
    pipeline: 'fixedBandFloater' | 'bandPair';
    bandPairCycle?: BandPairCycle;
    generation: V2GenerateResult;
    verification: CoverageVerificationReport;
};

export type StrictSixTwoPipelineOptions = CoverageVerificationOptions;

/** Pipeline banda par: 6 guardias × puesto 24hs, 2 por banda, francos desfasados. */
export function runBandPairPipeline(
    ctx: V2EngineContext,
    cycle: BandPairCycle,
    verifyOptions?: StrictSixTwoPipelineOptions,
): StrictSixTwoPipelineResult {
    if (!canUseBandPairCycle(ctx)) {
        throw new Error(`bandPair ${cycle}: layout inválido (requiere múltiplo de 6 guardias × puesto 24hs)`);
    }
    const generation = generateBandPairSchedule(ctx, cycle);
    const verification = verifyScheduleCoverage(
        ctx,
        generation.assignments,
        generation.stats,
        { inferModo12TCoverage: false, ...verifyOptions },
    );
    return { pipeline: 'bandPair', bandPairCycle: cycle, generation, verification };
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

/** @deprecated Usar runBandPairPipeline con cycle='6+1' */
export function runSixPlusOnePipeline(
    ctx: V2EngineContext,
    verifyOptions?: StrictSixTwoPipelineOptions,
): StrictSixTwoPipelineResult {
    return runBandPairPipeline(ctx, '6+1', verifyOptions);
}

/** @deprecated Usar runStrictSixTwoPipeline */
export const runCycleBasePipeline = runStrictSixTwoPipeline;
export type CycleBasePipelineResult = StrictSixTwoPipelineResult;
export type CycleBasePipelineOptions = StrictSixTwoPipelineOptions;
