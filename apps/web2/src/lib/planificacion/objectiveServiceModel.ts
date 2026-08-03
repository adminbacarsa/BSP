/**
 * Lectura del servicio (SLA) antes del motor: separar puestos **24 HS** vs **CUSTOM**.
 * Fuente de verdad: `ServicePosition.coverageType` cargado en planificación (`buildPlanningPositionStructure`).
 */

import type { V2PositionDef } from './autoScheduleEngineV2';
import { is24hsRotationPosition, isCustomCoverPosition } from './autoScheduleEngineV2';
import { customObjectivePeakConcurrentSlots, isFullCustomObjectivePool } from './objectiveHeadcount';

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

function peak24hsSimultaneous(positions: V2PositionDef[]): number {
    let peak = 0;
    for (const pos of positions) {
        const qty = Math.max(1, Number(pos.qty) || 1);
        peak += qty * 3;
    }
    return peak;
}

/**
 * Primer paso al armar cronograma: clasificar puestos del SLA vigente.
 * No infiere custom→24hs si `coverageType: 'custom'` está guardado en Servicios.
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
        labels.push(`${n24} puesto(s) 24 HS — rotación M/T/N (o D12/N12) por pax, esquema 6+2 típico.`);
    } else if (nCustom > 0 && n24 === 0 && positionsOther.length === 0) {
        kind = 'custom_only';
        motorMode = 'custom_pool';
        const peak = customObjectivePeakConcurrentSlots(positionsCustom);
        labels.push(
            `${nCustom} puesto(s) personalizado(s) — pool ~${peak} cupos/día; leer cobertura, condiciones y rotaciones del SLA.`,
        );
    } else {
        kind = 'mixed';
        motorMode = 'mixed_phased';
        labels.push(
            `Objetivo mixto: ${n24} puesto(s) 24 HS + ${nCustom} custom`
            + (positionsOther.length ? ` + ${positionsOther.length} otro(s)` : '')
            + '. Cerrar 24 HS antes que custom; cobertura SLA por legajo.',
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
            labels.push(`«${pos.positionName}»: sin coverageType en SLA — inferido 24 HS por M+T+N (legacy).`);
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

export function objectiveUsesCustomPoolOnly(positions: V2PositionDef[]): boolean {
    const p = partitionObjectiveServicePositions(positions);
    return p.kind === 'custom_only' || isFullCustomObjectivePool(positions);
}
