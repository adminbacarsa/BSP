/**
 * Tipos de cronograma por objetivo (leídos del SLA antes de generar).
 *
 * 1. **Puro 24 HS** — solo puestos `coverageType: 24hs`. Rotación M/T/N (o D12/N12) por pax;
 *    plantilla por pax × factor ciclo (típ. 6+2). No aplica pool custom ni cobertura M+T+N simultánea.
 *
 * 2. **Puro custom** — solo puestos personalizados. Cupos/bandas del SLA; sin rotación global M→T→N.
 *    Plantilla = pool (pico cupos × ciclo 5+1/6+1/6+2). Cobertura, condiciones y rotaciones SLA mandan.
 *
 * 3. **Mixto** — 24 HS + custom en el mismo objetivo. Roster en dos fases (24 HS primero), bandas 24h
 *    aisladas del pool custom; es el caso más delicado (no mezclar reglas de rotación con cupos custom).
 */

import type { V2PositionDef } from './autoScheduleEngineV2';
import { is24hsRotationPosition, isCustomCoverPosition } from './autoScheduleEngineV2';
import {
    computeObjectiveRequiredHeadcount,
    customObjectivePeakConcurrentSlots,
    isFullCustomObjectivePool,
} from './objectiveHeadcount';

export type ObjectiveServiceKind = '24hs_only' | 'custom_only' | 'mixed' | 'empty';

export type ObjectiveMotorMode =
    | 'rotative_24hs'
    | 'custom_pool'
    | 'mixed_phased';

export interface ObjectiveServicePartition {
    kind: ObjectiveServiceKind;
    motorMode: ObjectiveMotorMode;
    positions24hs: V2PositionDef[];
    positionsCustom: V2PositionDef[];
    positionsOther: V2PositionDef[];
    peakConcurrent24hs: number;
    peakConcurrentCustom: number;
    labels: string[];
}

/** Política de planificación derivada del tipo de crono. */
export interface ObjectiveScheduleProfile extends ObjectiveServicePartition {
    /** Título corto para UI / export. */
    cronogramTypeLabel: string;
    /** Orden de ciclos CCT a evaluar en el cerebro. */
    cyclePreference: readonly string[];
    /** Roster: cerrar cupo 24 HS antes que custom. */
    phasedRotativeFirst: boolean;
    /** Dotación por pax/pool (custom o mixto con custom). */
    headcountByPax: boolean;
    /** Requiere cobertura / rotaciones SLA para cerrar custom. */
    requiresSlaCobertura: boolean;
    /** Rotación péndulo global (solo tiene sentido en puro 24hs con viabilidad). */
    allowGlobalRotateShifts: boolean;
    /** Plantilla estructural estimada con ciclo dado. */
    plantillaForCycle: (cycleKey: string) => number;
}

const CYCLE_24HS: readonly string[] = ['6+2', '4+2'];
const CYCLE_CUSTOM_POOL: readonly string[] = ['5+1', '6+1', '6+2'];
const CYCLE_MIXED: readonly string[] = ['6+2', '5+1', '6+1'];

function peak24hsSimultaneous(positions: V2PositionDef[]): number {
    let peak = 0;
    for (const pos of positions) {
        const qty = Math.max(1, Number(pos.qty) || 1);
        peak += qty;
    }
    return peak;
}

export function cronogramTypeLabelEs(kind: ObjectiveServiceKind): string {
    switch (kind) {
        case '24hs_only':
            return 'Cronograma puro 24 HS';
        case 'custom_only':
            return 'Cronograma puro custom';
        case 'mixed':
            return 'Cronograma mixto (24 HS + custom)';
        default:
            return 'Sin estructura SLA';
    }
}

/**
 * Clasificar puestos del SLA vigente (primer paso obligatorio).
 */
export function partitionObjectiveServicePositions(
    positions: V2PositionDef[],
): ObjectiveServicePartition {
    const labels: string[] = [];
    const positions24hs: V2PositionDef[] = [];
    const positionsCustom: V2PositionDef[] = [];
    const positionsOther: V2PositionDef[] = [];

    for (const pos of positions) {
        if (is24hsRotationPosition(pos)) {
            positions24hs.push(pos);
            continue;
        }
        if (isCustomCoverPosition(pos)) {
            positionsCustom.push(pos);
            continue;
        }
        positionsOther.push(pos);
    }

    const n24 = positions24hs.length;
    const nCustom = positionsCustom.length;
    let kind: ObjectiveServiceKind = 'empty';
    let motorMode: ObjectiveMotorMode = 'custom_pool';

    if (n24 === 0 && nCustom === 0 && positionsOther.length === 0) {
        kind = 'empty';
        labels.push('Sin puestos en el SLA vigente.');
    } else if (n24 > 0 && nCustom === 0 && positionsOther.length === 0) {
        kind = '24hs_only';
        motorMode = 'rotative_24hs';
        labels.push(`${n24} puesto(s) 24 HS — rotación por pax (qty variable), ciclo 6+2 típico.`);
    } else if (nCustom > 0 && n24 === 0 && positionsOther.length === 0) {
        kind = 'custom_only';
        motorMode = 'custom_pool';
        const peak = customObjectivePeakConcurrentSlots(positionsCustom);
        labels.push(
            `${nCustom} puesto(s) custom — pool ~${peak} cupos/día; cobertura + condiciones + rotaciones SLA.`,
        );
    } else {
        kind = 'mixed';
        motorMode = 'mixed_phased';
        labels.push(
            `Mixto: ${n24}×24 HS + ${nCustom} custom`
            + (positionsOther.length ? ` + ${positionsOther.length} otro(s)` : '')
            + ' — fase 1: cupo 24 HS; fase 2: custom (sin mezclar rotación M/T/N con cupos).',
        );
    }

    for (const pos of positions) {
        const stored = String(pos.coverageType || '').trim();
        const codes = (pos.shifts || []).map((s) => String(s.code ?? '').toUpperCase()).filter(Boolean);
        const hasMtn = ['M', 'T', 'N'].every((c) => codes.includes(c));
        if (hasMtn && stored.toLowerCase() === 'custom' && isCustomCoverPosition(pos)) {
            labels.push(`«${pos.positionName}»: CUSTOM con M+T+N = cupos simultáneos (no rotación 24 HS).`);
        }
        if (hasMtn && !stored && is24hsRotationPosition(pos)) {
            labels.push(`«${pos.positionName}»: sin coverageType — inferido 24 HS (legacy).`);
        }
    }

    return {
        kind,
        motorMode,
        positions24hs,
        positionsCustom,
        positionsOther,
        peakConcurrent24hs: peak24hsSimultaneous(positions24hs),
        peakConcurrentCustom: nCustom > 0 ? customObjectivePeakConcurrentSlots(positionsCustom) : 0,
        labels,
    };
}

/** Perfil completo: partición + reglas de motor/cerebro. */
export function buildObjectiveScheduleProfile(positions: V2PositionDef[]): ObjectiveScheduleProfile {
    const partition = partitionObjectiveServicePositions(positions);
    const { kind } = partition;

    let cyclePreference: readonly string[];
    let phasedRotativeFirst = false;
    let headcountByPax = false;
    let requiresSlaCobertura = false;
    let allowGlobalRotateShifts = false;

    switch (kind) {
        case '24hs_only':
            cyclePreference = CYCLE_24HS;
            headcountByPax = true;
            allowGlobalRotateShifts = true;
            break;
        case 'custom_only':
            cyclePreference = CYCLE_CUSTOM_POOL;
            headcountByPax = true;
            requiresSlaCobertura = true;
            break;
        case 'mixed':
            cyclePreference = CYCLE_MIXED;
            phasedRotativeFirst = true;
            headcountByPax = true;
            requiresSlaCobertura = true;
            allowGlobalRotateShifts = false;
            break;
        default:
            cyclePreference = CYCLE_24HS;
            break;
    }

    const allPositions = positions;
    return {
        ...partition,
        cronogramTypeLabel: cronogramTypeLabelEs(kind),
        cyclePreference,
        phasedRotativeFirst,
        headcountByPax,
        requiresSlaCobertura,
        allowGlobalRotateShifts,
        plantillaForCycle: (cycleKey: string) => computeObjectiveRequiredHeadcount(allPositions, cycleKey),
    };
}

export function resolveCyclePreferenceForPositions(positions: V2PositionDef[]): readonly string[] {
    return buildObjectiveScheduleProfile(positions).cyclePreference;
}

export function objectiveUsesCustomPoolOnly(positions: V2PositionDef[]): boolean {
    return buildObjectiveScheduleProfile(positions).kind === 'custom_only';
}

export function objectiveIsMixedSchedule(positions: V2PositionDef[]): boolean {
    return buildObjectiveScheduleProfile(positions).kind === 'mixed';
}

export function objectiveIs24hsOnly(positions: V2PositionDef[]): boolean {
    return buildObjectiveScheduleProfile(positions).kind === '24hs_only';
}

/** @deprecated Usar buildObjectiveScheduleProfile */
export function objectiveUsesCustomPoolOnlyLegacy(positions: V2PositionDef[]): boolean {
    return isFullCustomObjectivePool(positions);
}
