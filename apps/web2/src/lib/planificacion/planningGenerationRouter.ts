/**
 * Única fuente de verdad: tipo de cronograma SLA → motor de generación.
 * Auto Lab, wizard Planificación y V4 deben usar estas funciones.
 */

import type { V2EngineContext, V2GenerateResult } from './autoScheduleEngineV2';
import { generateScheduleV4 } from './autoScheduleEngineV4';
import { generateScheduleMixedObjective } from './mixedScheduleEngine';
import {
    buildObjectiveScheduleProfile,
    objectiveIs24hsOnly,
    objectiveIsMixedSchedule,
    type ObjectiveServiceKind,
} from './objectiveServiceModel';
import { canUseFixedBandFloater } from './fixedBandFloaterScheduleEngine';
import { canUseSixPlusOne } from './sixPlusOneEngine';
import { runSixPlusOnePipeline, runStrictSixTwoPipeline } from './planningPipeline';
import { shouldBypassFixedBandFloater } from './scheduleObjectiveFlags';
import { prepare24hsPlanningContext } from './planningOrchestrator24hs';

export type PlanningGenerationMotorId =
    | 'mixed_phased'
    | 'strict_six_two_floater'
    | 'six_plus_one'
    | 'v4';

export type PlanningGenerationRoute = {
    serviceKind: ObjectiveServiceKind;
    motorId: PlanningGenerationMotorId;
    /** Etiqueta para UI / export (Auto Lab pipeline). */
    postProcessPipeline: 'fixedBandFloater' | 'v4';
    labelEs: string;
    reasons: string[];
};

export type PlanningGenerationRunResult = {
    route: PlanningGenerationRoute;
    generation: V2GenerateResult;
    genCtx: V2EngineContext;
    prepareWarnings: string[];
};

export function resolvePlanningGenerationRoute(
    ctx: V2EngineContext,
    opts?: { strictSixTwo?: boolean; preferSixPlusOne?: boolean },
): PlanningGenerationRoute {
    const profile = buildObjectiveScheduleProfile(ctx.positions);
    const reasons: string[] = [];
    const strictSixTwo = opts?.strictSixTwo === true;
    const preferSixPlusOne = opts?.preferSixPlusOne === true;

    if (profile.kind === 'mixed') {
        reasons.push('SLA mixto (24 HS + custom) → fase 24 HS (floater) + fase custom.');
        return {
            serviceKind: 'mixed',
            motorId: 'mixed_phased',
            postProcessPipeline: 'fixedBandFloater',
            labelEs: 'Mixto en dos fases',
            reasons,
        };
    }

    if (profile.kind === 'custom_only') {
        reasons.push('SLA 100 % custom → motor V2 (pool / cupos), sin ciclo 24d global.');
        return {
            serviceKind: 'custom_only',
            motorId: 'v4',
            postProcessPipeline: 'v4',
            labelEs: 'Custom (pool V2)',
            reasons,
        };
    }

    if (profile.kind === '24hs_only') {
        const bypassFloater = shouldBypassFixedBandFloater(ctx.positions);
        const canFloater = !bypassFloater && canUseFixedBandFloater(ctx);
        const can6x1 = preferSixPlusOne && canUseSixPlusOne(ctx);

        if (can6x1) {
            reasons.push('Puro 24 HS · layout 6+1 → motor seis más uno.');
            return {
                serviceKind: '24hs_only',
                motorId: 'six_plus_one',
                postProcessPipeline: 'fixedBandFloater',
                labelEs: '24 HS · ciclo 6+1',
                reasons,
            };
        }

        if (canFloater) {
            reasons.push('Puro 24 HS → ciclo 24d + flotante (6+2 bandas fijas).');
            return {
                serviceKind: '24hs_only',
                motorId: 'strict_six_two_floater',
                postProcessPipeline: 'fixedBandFloater',
                labelEs: '24 HS · floater 6+2',
                reasons,
            };
        }

        reasons.push('Puro 24 HS · multipax / layout sin floater → V4.');
        return {
            serviceKind: '24hs_only',
            motorId: 'v4',
            postProcessPipeline: 'v4',
            labelEs: '24 HS · motor V4',
            reasons,
        };
    }

    reasons.push('Sin puestos SLA reconocidos → V4 genérico.');
    return {
        serviceKind: 'empty',
        motorId: 'v4',
        postProcessPipeline: 'v4',
        labelEs: 'V4 (fallback)',
        reasons,
    };
}

/**
 * Prepara contexto (padding/roster solo en puro 24hs) y ejecuta el motor elegido.
 */
export function runPlanningGeneration(
    baseCtx: V2EngineContext,
    opts?: { strictSixTwo?: boolean; preferSixPlusOne?: boolean },
): PlanningGenerationRunResult {
    const prepared = prepare24hsPlanningContext(baseCtx);
    if (!prepared.ok) {
        throw new Error(prepared.errors.join(' '));
    }
    const genCtx = prepared.ctx;
    const route = resolvePlanningGenerationRoute(genCtx, opts);

    let generation: V2GenerateResult;

    switch (route.motorId) {
        case 'mixed_phased':
            generation = generateScheduleMixedObjective(genCtx);
            break;
        case 'six_plus_one': {
            const piped = runSixPlusOnePipeline(genCtx);
            generation = piped.generation;
            break;
        }
        case 'strict_six_two_floater': {
            try {
                const piped = runStrictSixTwoPipeline({
                    ...genCtx,
                    rotateShifts: false,
                    demandDriven: false,
                });
                generation = piped.generation;
            } catch {
                generation = generateScheduleV4({
                    ...genCtx,
                    rotateShifts: false,
                    demandDriven: false,
                });
            }
            break;
        }
        case 'v4':
        default:
            generation = generateScheduleV4({
                ...genCtx,
                ...(route.serviceKind === 'custom_only' ? { rotateShifts: false } : {}),
            });
            break;
    }

    return {
        route,
        generation,
        genCtx,
        prepareWarnings: prepared.warnings,
    };
}

/** Helpers para cerebro / UI sin duplicar lógica. */
export {
    objectiveIsMixedSchedule,
    objectiveIs24hsOnly,
    buildObjectiveScheduleProfile,
};
