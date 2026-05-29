/**
 * Orquestación planificador — etapas separadas (ciclo vs cobertura).
 *
 * A) bandas fijas + flotante (6+2 exacto, 24hs qty=1) — algebraico
 * B) verifyScheduleCoverage — verificación pura (sin fix)
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

export type StrictSixTwoPipelineResult = {
    pipeline: 'fixedBandFloater';
    generation: V2GenerateResult;
    verification: CoverageVerificationReport;
};

export type StrictSixTwoPipelineOptions = CoverageVerificationOptions;

/** Etapa A + B: cuarteto M/T/N/flotante y verificación sin parches. */
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
