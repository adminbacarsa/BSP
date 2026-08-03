/**
 * Contrato operativo: puesto **24 h rotativo** (Servicios → "24 HORAS") vs **personalizado** (cupos/bandas del SLA).
 *
 * ## Diferencia de negocio (no confundir con el nombre del turno en el cronograma)
 *
 * **Puesto / turno 24 h**
 * - La cobertura del puesto exige que **los guardias roten de banda**: pasan por M, T y N (o D12/N12).
 * - Hace falta un **esquema de rotación** (típicamente **6+2** en CCT) y dotación suficiente por pax.
 * - El motor asigna bandas en secuencia rotativa por grupo de puesto, no “elegir M o T según cupo del día”.
 *
 * **Puesto personalizado (`coverageType: custom`)**
 * - **No hay rotación obligatoria M→T→N.** M, T y N en el mismo puesto suelen ser **cupos simultáneos** (ej. Control: 1 M + 1 T + 1 N el mismo día).
 * - Quién trabaja qué banda se define en **Servicios → Cobertura de dotación** (`positionAssignments`):
 *   un legajo puede quedar solo en M, cubrir M y T y nunca N, etc.
 * - El **ciclo trabajo/franco** (5+1, 6+1, 6+2…) es independiente de la rotación de bandas: se elige según
 *   horas del personal, cupos a cubrir y viabilidad del mes; no implica que todos roten por las tres bandas.
 *
 * Fuente de verdad en Firestore: `ServicePosition.coverageType` + opcional `positionAssignments` en el SLA.
 * El motor no debe re-clasificar un puesto marcado `custom` como 24 h por tener M/T/N.
 */

import type { V2PositionDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition, is24hsRotationPosition } from './autoScheduleEngineV2';
import {
    customCoverDistinctBandCount,
    customCoverSimultaneousPax,
    customCoverSlotsRequiredOnDay,
} from './customCoverCycle';
import { isFullCustomObjectivePool } from './objectiveHeadcount';
import { hasPositionAssignmentPolicy } from './positionAssignmentPolicy';
import type { V2EngineContext } from './autoScheduleEngineV2';

const MTN = new Set(['M', 'T', 'N']);

export type PositionCoverageKind =
    | '24hs_rotation'
    | '12hs_diurno'
    | '12hs_nocturno'
    | 'custom_concurrent_mtn'
    | 'custom_multi_band'
    | 'custom_single_band';

export function positionCoverageKind(pos: V2PositionDef): PositionCoverageKind {
    const cov = String(pos.coverageType || '').toLowerCase().trim();
    if (cov === '12hs_diurno') return '12hs_diurno';
    if (cov === '12hs_nocturno') return '12hs_nocturno';
    if (is24hsRotationPosition(pos)) return '24hs_rotation';
    if (!isCustomCoverPosition(pos)) return 'custom_single_band';

    const bandCount = customCoverDistinctBandCount(pos);
    const codes = new Set(
        (pos.shifts || []).map((s) => String(s.code ?? '').toUpperCase()).filter(Boolean),
    );
    const hasFullMtn = ['M', 'T', 'N'].every((c) => codes.has(c));
    if (hasFullMtn && bandCount >= 3) return 'custom_concurrent_mtn';
    if (bandCount > 1) return 'custom_multi_band';
    return 'custom_single_band';
}

export function positionCoverageKindLabelEs(kind: PositionCoverageKind): string {
    switch (kind) {
        case '24hs_rotation':
            return '24 h rotativo (M/T/N o D12/N12 por pax)';
        case '12hs_diurno':
            return '12 h diurno';
        case '12hs_nocturno':
            return '12 h nocturno';
        case 'custom_concurrent_mtn':
            return 'Personalizado — M+T+N cupos simultáneos (no rotación 24 h)';
        case 'custom_multi_band':
            return 'Personalizado — varias bandas / códigos por día';
        case 'custom_single_band':
            return 'Personalizado — turno/código fijo';
        default:
            return 'Personalizado';
    }
}

export interface ObjectiveCoverageSummary {
    has24hsRotation: boolean;
    allCustomPool: boolean;
    /** Si el SLA tiene `positionAssignments`, el motor debe respetar puesto/banda por legajo. */
    reliesOnSlaCoberturaDotacion: boolean;
    /** Texto para Auto Lab / planificación (no implica motor rotativo global). */
    motorLabel: string;
    peakConcurrentSlots: number;
    positions: Array<{
        positionName: string;
        kind: PositionCoverageKind;
        kindLabel: string;
        slotsTypicalDay: number;
        coverageTypeStored: string;
    }>;
    warnings: string[];
}

export function summarizeObjectiveCoverage(
    positions: V2PositionDef[],
    ctx?: Pick<V2EngineContext, 'positionAssignmentsByEmp'>,
): ObjectiveCoverageSummary {
    const warnings: string[] = [];
    const positionsOut: ObjectiveCoverageSummary['positions'] = [];
    let peak = 0;
    const reliesOnSla = ctx ? hasPositionAssignmentPolicy(ctx) : false;

    for (const pos of positions) {
        const kind = positionCoverageKind(pos);
        let slots = 0;
        for (const day of ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const) {
            slots = Math.max(slots, customCoverSlotsRequiredOnDay(pos, day));
        }
        if (is24hsRotationPosition(pos)) {
            const qty = Math.max(1, Number(pos.qty) || 1);
            slots = qty * 3;
        }
        peak = Math.max(peak, slots);

        const stored = String(pos.coverageType || '').trim() || '(sin tipo)';
        if (
            kind === 'custom_concurrent_mtn'
            && (stored.toLowerCase() === '24hs' || stored.toLowerCase() === '24')
        ) {
            warnings.push(
                `«${pos.positionName}»: tiene M+T+N pero coverageType=${stored}. En Servicios debe ser «Personalizado» si son 3 cupos/día.`,
            );
        }
        if (kind === '24hs_rotation' && stored.toLowerCase() === 'custom') {
            warnings.push(
                `«${pos.positionName}»: coverageType=custom pero el motor lo trata como 24 h por bandas M+T+N sin flag explícito — revisá Servicios.`,
            );
        }
        if (isCustomCoverPosition(pos) && !reliesOnSla && kind !== 'custom_single_band') {
            warnings.push(
                `«${pos.positionName}»: personalizado con varias bandas — activá Cobertura de dotación en Servicios para fijar quién cubre M/T/N.`,
            );
        }

        positionsOut.push({
            positionName: pos.positionName,
            kind,
            kindLabel: positionCoverageKindLabelEs(kind),
            slotsTypicalDay: slots,
            coverageTypeStored: stored,
        });
    }

    const has24hsRotation = positions.some(is24hsRotationPosition);
    const allCustomPool = isFullCustomObjectivePool(positions);

    let motorLabel: string;
    if (allCustomPool) {
        motorLabel = reliesOnSla
            ? `Objetivo 100 % personalizado — pool ~${peak} cupos/día; bandas por Cobertura de dotación (ciclo 5+1/6+1/6+2 según viabilidad)`
            : `Objetivo 100 % personalizado — pool ~${peak} cupos/día (sin rotación 24 h global)`;
    } else if (has24hsRotation && positions.some(isCustomCoverPosition)) {
        motorLabel = 'Mixto: puesto(s) 24 h rotativo + personalizado(s)';
    } else if (has24hsRotation) {
        motorLabel = 'Puesto(s) 24 h — rotación M/T/N (o D12/N12) por pax; esquema 6+2';
    } else {
        motorLabel = 'Personalizado — bandas/códigos del SLA';
    }

    return {
        has24hsRotation,
        allCustomPool,
        reliesOnSlaCoberturaDotacion: reliesOnSla,
        motorLabel,
        peakConcurrentSlots: peak,
        positions: positionsOut,
        warnings,
    };
}

/** Normaliza coverageType al cargar desde SLA (nunca degradar custom → 24hs por inferencia M+T+N). */
export function normalizeCoverageTypeFromSla(
    raw: string | undefined,
    shifts: Array<{ code?: string }>,
): '24hs' | 'custom' | '12hs_diurno' | '12hs_nocturno' | string {
    const cov = String(raw || '').toLowerCase().trim();
    if (cov === 'custom') return 'custom';
    if (cov === '24hs' || cov === '24' || cov === '24h') return '24hs';
    if (cov === '12hs_diurno' || cov === '12hs_nocturno') return cov;
    if (!cov) {
        const codes = new Set(shifts.map((s) => String(s.code ?? '').toUpperCase()));
        if (codes.has('M') && codes.has('T') && codes.has('N') && [...codes].every((c) => MTN.has(c) || c === 'D12' || c === 'N12')) {
            return '24hs';
        }
        return 'custom';
    }
    return cov;
}
