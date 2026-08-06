/**
 * Reglas de planificación por tipo de cronograma (puro 24 HS | puro custom | mixto).
 *
 * Flujo operativo recomendado:
 *  1. Clasificar (`buildObjectiveScheduleProfile`)
 *  2. Resolver reglas (`resolveCronogramPlanningRules`)
 *  3. Viabilidad + cerebro (ciclos, rotateShifts según reglas)
 *  4. Roster (orden y pools según reglas.roster)
 *  5. Generación V2 (bandas según reglas.generation)
 *  6. Post-proceso SLA (condiciones) + validación (reglas.validation)
 */

import type { V2PositionDef } from './autoScheduleEngineV2';
import {
    buildObjectiveScheduleProfile,
    type ObjectiveScheduleProfile,
    type ObjectiveServiceKind,
} from './objectiveServiceModel';
import type { SlaContractReadiness } from './slaContractPlanning';

export type CronogramHeadcountFormula = 'per_pax_24hs' | 'custom_pool' | 'mixed_24hs_plus_pool';

export type CronogramBandSource24hs = 'pendulum_rotate' | 'fixed_or_modo12';
export type CronogramBandSourceCustom = 'sla_rotation_first' | 'dotacion_default' | 'engine_demand';

export interface CronogramFeasibilityRules {
    headcountByPax: boolean;
    headcountFormula: CronogramHeadcountFormula;
    cyclePreference: readonly string[];
    /** Horas vendidas SLA como techo blando (custom/mixto con contrato). */
    respectContractHours: boolean;
}

export interface CronogramRosterRules {
    phasedByKind: boolean;
    /** Orden de llenado de grupos por puesto. */
    fillKindOrder: readonly ('24hs' | 'custom' | 'other')[];
    /** Varios puestos custom comparten un pool de plantilla (no headcount por puesto). */
    customPositionsSharePool: boolean;
    /** Filtrar legajos al roster con cobertura de dotación SLA. */
    enforcePositionAssignmentsOnRoster: boolean;
}

export interface CronogramGenerationRules {
    allowGlobalRotateShifts: boolean;
    bandSource24hs: CronogramBandSource24hs;
    bandSourceCustom: CronogramBandSourceCustom;
    /** En mixto: un guardia del cupo 24hs no cubre huecos custom (pools separados). */
    allow24hsBackupForCustom: boolean;
    /** No rellenar huecos rompiendo secuencia M→T→N en puestos 24hs. */
    preserveRotativeIntegrity: boolean;
}

export interface CronogramSlaRules {
    coberturaDotacionRequired: boolean;
    rotacionesRecommended: boolean;
    condicionesPostProcess: boolean;
}

export interface CronogramValidationRules {
    positionAssignments: boolean;
    customConcurrentSlots: boolean;
    rotative24hsSequence: boolean;
}

export interface CronogramPlanningRules {
    kind: ObjectiveServiceKind;
    motorMode: ObjectiveScheduleProfile['motorMode'];
    cronogramTypeLabel: string;
    feasibility: CronogramFeasibilityRules;
    roster: CronogramRosterRules;
    generation: CronogramGenerationRules;
    sla: CronogramSlaRules;
    validation: CronogramValidationRules;
    /** Guía para cerebro / export / UI (no sustituye diagnóstico de viabilidad). */
    playbook: string[];
}

const FILL_24HS_FIRST: readonly ('24hs' | 'custom' | 'other')[] = ['24hs', 'custom', 'other'];
const FILL_CUSTOM_ONLY: readonly ('24hs' | 'custom' | 'other')[] = ['custom', 'other'];

function playbookForKind(kind: ObjectiveServiceKind): string[] {
    switch (kind) {
        case '24hs_only':
            return [
                'Plantilla = Σ pax 24hs × factor ciclo (6+2 o 4+2); qty por puesto = personas en servicio simultáneo.',
                'Roster por grupo de puesto; bandas con péndulo M→T→N si viabilidad y dotación lo permiten.',
                'Modo 12 / contingencia solo sobre puestos 24hs; no usar pool custom ni cobertura M+T+N simultánea.',
                'Validar secuencia rotativa y francos CCT; RET solo como stand-by operativo.',
            ];
        case 'custom_only':
            return [
                'Plantilla = pico de cupos simultáneos (todos los custom) × factor ciclo (probar 5+1 → 6+1 → 6+2).',
                'M+T+N en un puesto = cupos el mismo día, no rotación 24h.',
                'Obligatorio: Cobertura de dotación (quién puede qué banda); Rotaciones SLA para banda por fecha.',
                'Condiciones SLA post-proceso; validar positionAssignments y cupos por día.',
            ];
        case 'mixed':
            return [
                'Plantilla = plantilla 24hs (por pax × ciclo 6+2) + Σ titulares custom por cupo; no un solo ciclo ni pool custom global.',
                'Roster fase 1: completar grupos 24hs; fase 2: custom con restricciones SLA.',
                'Desactivar rotateShifts global; bandas 24hs y custom con fuentes distintas.',
                'Prohibir backup 24hs→custom; validar cada sub-sistema por separado.',
            ];
        default:
            return ['Completar estructura de puestos en el SLA vigente antes de automatizar.'];
    }
}

function rulesFromProfile(profile: ObjectiveScheduleProfile): CronogramPlanningRules {
    const { kind } = profile;

    switch (kind) {
        case '24hs_only':
            return {
                kind,
                motorMode: profile.motorMode,
                cronogramTypeLabel: profile.cronogramTypeLabel,
                feasibility: {
                    headcountByPax: true,
                    headcountFormula: 'per_pax_24hs',
                    cyclePreference: profile.cyclePreference,
                    respectContractHours: false,
                },
                roster: {
                    phasedByKind: false,
                    fillKindOrder: FILL_24HS_FIRST,
                    customPositionsSharePool: false,
                    enforcePositionAssignmentsOnRoster: false,
                },
                generation: {
                    allowGlobalRotateShifts: true,
                    bandSource24hs: 'pendulum_rotate',
                    bandSourceCustom: 'engine_demand',
                    allow24hsBackupForCustom: true,
                    preserveRotativeIntegrity: true,
                },
                sla: {
                    coberturaDotacionRequired: false,
                    rotacionesRecommended: false,
                    condicionesPostProcess: true,
                },
                validation: {
                    positionAssignments: false,
                    customConcurrentSlots: false,
                    rotative24hsSequence: true,
                },
                playbook: playbookForKind(kind),
            };

        case 'custom_only':
            return {
                kind,
                motorMode: profile.motorMode,
                cronogramTypeLabel: profile.cronogramTypeLabel,
                feasibility: {
                    headcountByPax: true,
                    headcountFormula: 'custom_pool',
                    cyclePreference: profile.cyclePreference,
                    respectContractHours: true,
                },
                roster: {
                    phasedByKind: false,
                    fillKindOrder: FILL_CUSTOM_ONLY,
                    customPositionsSharePool: true,
                    enforcePositionAssignmentsOnRoster: true,
                },
                generation: {
                    allowGlobalRotateShifts: false,
                    bandSource24hs: 'fixed_or_modo12',
                    bandSourceCustom: 'sla_rotation_first',
                    allow24hsBackupForCustom: false,
                    preserveRotativeIntegrity: false,
                },
                sla: {
                    coberturaDotacionRequired: true,
                    rotacionesRecommended: true,
                    condicionesPostProcess: true,
                },
                validation: {
                    positionAssignments: true,
                    customConcurrentSlots: true,
                    rotative24hsSequence: false,
                },
                playbook: playbookForKind(kind),
            };

        case 'mixed':
            return {
                kind,
                motorMode: profile.motorMode,
                cronogramTypeLabel: profile.cronogramTypeLabel,
                feasibility: {
                    headcountByPax: true,
                    headcountFormula: 'mixed_24hs_plus_pool',
                    cyclePreference: profile.cyclePreference,
                    respectContractHours: true,
                },
                roster: {
                    phasedByKind: true,
                    fillKindOrder: FILL_24HS_FIRST,
                    customPositionsSharePool: true,
                    enforcePositionAssignmentsOnRoster: true,
                },
                generation: {
                    allowGlobalRotateShifts: false,
                    bandSource24hs: 'pendulum_rotate',
                    bandSourceCustom: 'sla_rotation_first',
                    allow24hsBackupForCustom: false,
                    preserveRotativeIntegrity: true,
                },
                sla: {
                    coberturaDotacionRequired: true,
                    rotacionesRecommended: true,
                    condicionesPostProcess: true,
                },
                validation: {
                    positionAssignments: true,
                    customConcurrentSlots: true,
                    rotative24hsSequence: true,
                },
                playbook: playbookForKind(kind),
            };

        default:
            return {
                kind: 'empty',
                motorMode: profile.motorMode,
                cronogramTypeLabel: profile.cronogramTypeLabel,
                feasibility: {
                    headcountByPax: true,
                    headcountFormula: 'per_pax_24hs',
                    cyclePreference: profile.cyclePreference,
                    respectContractHours: false,
                },
                roster: {
                    phasedByKind: false,
                    fillKindOrder: FILL_24HS_FIRST,
                    customPositionsSharePool: false,
                    enforcePositionAssignmentsOnRoster: false,
                },
                generation: {
                    allowGlobalRotateShifts: false,
                    bandSource24hs: 'fixed_or_modo12',
                    bandSourceCustom: 'engine_demand',
                    allow24hsBackupForCustom: false,
                    preserveRotativeIntegrity: false,
                },
                sla: {
                    coberturaDotacionRequired: false,
                    rotacionesRecommended: false,
                    condicionesPostProcess: false,
                },
                validation: {
                    positionAssignments: false,
                    customConcurrentSlots: false,
                    rotative24hsSequence: false,
                },
                playbook: playbookForKind('empty'),
            };
    }
}

export function resolveCronogramPlanningRules(positions: V2PositionDef[]): CronogramPlanningRules {
    const profile = buildObjectiveScheduleProfile(positions);
    const rules = rulesFromProfile(profile);
    return {
        ...rules,
        playbook: [...profile.labels, ...rules.playbook],
    };
}

/** Campos de `V2EngineContext` derivados de las reglas (flags ya usados por V2). */
export function cronogramRulesToEngineFlags(rules: CronogramPlanningRules): {
    headcountByPax: boolean;
    schedulePhasedRotativeFirst: boolean;
    preserveRotativeIntegrity: boolean;
    allowCustom24hsBackup: boolean;
    cronogramKind: ObjectiveServiceKind;
    cronogramTypeLabel: string;
} {
    return {
        headcountByPax: rules.feasibility.headcountByPax,
        schedulePhasedRotativeFirst: rules.roster.phasedByKind,
        preserveRotativeIntegrity: rules.generation.preserveRotativeIntegrity,
        allowCustom24hsBackup: rules.generation.allow24hsBackupForCustom,
        cronogramKind: rules.kind,
        cronogramTypeLabel: rules.cronogramTypeLabel,
    };
}

/** Avisos si el SLA no cumple lo que el tipo de crono exige. */
export function cronogramSlaRuleWarnings(
    rules: CronogramPlanningRules,
    readiness: SlaContractReadiness,
): string[] {
    const out: string[] = [];
    if (rules.sla.coberturaDotacionRequired && !readiness.hasCobertura) {
        out.push(
            'Regla custom/mixto: falta Cobertura de dotación en SLA — el cronograma no puede replicar asignación manual.',
        );
    }
    if (rules.sla.rotacionesRecommended && !readiness.hasRotaciones) {
        out.push(
            'Regla custom/mixto: sin Rotaciones SLA — las bandas salen del motor genérico (riesgo de huecos en Salon/Control).',
        );
    }
    if (rules.sla.condicionesPostProcess && !readiness.hasCondiciones) {
        out.push('Sin Condiciones SLA — no hay exclusiones IF→THEN automáticas por día.');
    }
    return out;
}

export function formatCronogramPlaybookForBrain(rules: CronogramPlanningRules): string[] {
    return [
        `Motor: ${rules.motorMode} | Plantilla: ${rules.feasibility.headcountFormula}`,
        ...rules.playbook.map((line, i) => `${i + 1}. ${line}`),
    ];
}
