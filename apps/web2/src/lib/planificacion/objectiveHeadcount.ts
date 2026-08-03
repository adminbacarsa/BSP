import type { V2PositionDef } from './autoScheduleEngineV2';
import { is24hsRotationPosition, isCustomCoverPosition } from './autoScheduleEngineV2';
import {
    customCoverRequiredHeadcount,
    customCoverSimultaneousPax,
    customCoverSlotsRequiredOnDay,
} from './customCoverCycle';

const CYCLE_MAP: Record<string, [number, number]> = {
    '6+2': [6, 2],
    '5+1': [5, 1],
    '6+1': [6, 1],
    '4+2': [4, 2],
};

/** Bandas 8h por pax en cobertura 24hs (M + T + N). */
const BANDS_PER_PAX_24HS = 3;

/** Guardias agregados automáticamente por padPlanningRoster (lab-pad-05…). */
export function isLabPaddingEmpId(empId: string): boolean {
    return empId.startsWith('lab-pad-');
}

/** @deprecated Usar isLabPaddingEmpId. lab-emp-* son legajos del caso Lab, no padding. */
export function isLabSyntheticEmpId(empId: string): boolean {
    return isLabPaddingEmpId(empId);
}

/**
 * Cupo de guardias de un puesto según reglas de pax (sin inflar por horas del mes).
 */
export function effectivePositionGroupNeed(
    pos: V2PositionDef,
    positionNeed: Record<string, number>,
    _monthHours?: number,
    _hardMax?: number,
    cycleKey: string = '6+2',
): number {
    const fromMap = positionNeed[pos.positionName];
    if (fromMap != null && fromMap > 0) return fromMap;
    return computePositionRequiredHeadcount(pos, cycleKey);
}

/**
 * Estimación auxiliar: personas si se repartieran horas SLA a tope CCT (~192h).
 * Solo referencia comercial; la dotación operativa sale de {@link computeObjectiveRequiredHeadcount}.
 */
export function estimatePeopleFromContractHours(
    hours: number,
    targetAvgHours: number = 192,
): number {
    if (hours <= 0 || targetAvgHours <= 0) return 0;
    return Math.ceil(hours / targetAvgHours);
}

function is24hsPosition(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

/**
 * Incremento de plantilla por cada pax 24hs (ej. 6+2 → 4 guardias por pax).
 * Varios pax comparten el mismo pool de rotación (los guardias pueden intercambiarse entre bandas/pax).
 */
export function headcountPerPax24hs(cycleKey: string = '6+2'): number {
    const [cL, cF] = CYCLE_MAP[cycleKey] ?? CYCLE_MAP['6+2'];
    const cycleFactor = (cL + cF) / cL;
    return Math.ceil(BANDS_PER_PAX_24HS * cycleFactor);
}

/** @deprecated Alias de headcountPerPax24hs */
export const rotationPoolPerPax24hs = headcountPerPax24hs;

/**
 * Guardias necesarios para cubrir un puesto en el objetivo (plantilla mensual).
 *
 * ## Puesto 24hs
 * - `qty` = pax en servicio simultáneo (1 pax = 1 persona en M, T y N a la vez).
 * - Con 6+2: **4 guardias por pax** (3×8h + franco en rotación).
 * - 2 pax → **8 guardias** en un **pool común** de rotación (se pueden intercambiar entre bandas/pax).
 *
 * ## Puesto custom (MA, ME, horario fijo)
 * - `qty` = pax en simultáneo cada día operativo (4 en Museo = 4 personas en MA a la vez).
 * - **L–D (7 días):** plantilla = ceil(qty × 7 / díasTrabajoSemanal) — ej. 4 pax en 6+1 → **5 guardias**.
 * - **L–V u horario acotado:** plantilla = qty (francos en días sin servicio del puesto).
 */
export function computePositionRequiredHeadcount(
    pos: V2PositionDef,
    cycleKey: string = '6+2',
): number {
    const qty = Math.max(1, Number(pos.qty) || 1);

    if (isCustomCoverPosition(pos)) {
        return customCoverRequiredHeadcount(pos);
    }

    if (is24hsPosition(pos)) {
        return qty * headcountPerPax24hs(cycleKey);
    }

    const [cL, cF] = CYCLE_MAP[cycleKey] ?? CYCLE_MAP['6+2'];
    const cycleFactor = (cL + cF) / cL;
    const activeDayLetters = pos.activeDays?.length ?? 7;
    const operatesLimited = activeDayLetters > 0 && activeDayLetters < 7;
    if (operatesLimited) {
        return qty;
    }

    return Math.ceil(qty * cycleFactor);
}

const POOL_WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

/** Objetivo 100 % custom (ej. Shopping): cupos simultáneos comparten pool de guardias, no plantilla por puesto. */
export function isFullCustomObjectivePool(positions: V2PositionDef[]): boolean {
    return positions.length > 0 && positions.every(isCustomCoverPosition);
}

/** Pico de cupos SLA en un día (suma puestos × bandas activas). */
export function customObjectivePeakConcurrentSlots(positions: V2PositionDef[]): number {
    let peak = 0;
    for (const day of POOL_WEEKDAY_LETTERS) {
        let daySlots = 0;
        for (const pos of positions) {
            if (!isCustomCoverPosition(pos)) continue;
            daySlots += customCoverSlotsRequiredOnDay(pos, day);
        }
        peak = Math.max(peak, daySlots);
    }
    return peak;
}

/** Plantilla del objetivo custom pool: ceil(pico × factor ciclo), no suma de headcount por puesto. */
export function computeCustomObjectivePoolHeadcount(
    positions: V2PositionDef[],
    cycleKey: string = '6+2',
): number {
    const peak = customObjectivePeakConcurrentSlots(positions);
    const [cL, cF] = CYCLE_MAP[cycleKey] ?? CYCLE_MAP['6+2'];
    const factor = (cL + cF) / cL;
    return Math.max(1, Math.ceil(peak * factor));
}

export function computeObjectiveRequiredHeadcount(
    positions: V2PositionDef[],
    cycleKey: string = '6+2',
): number {
    if (isFullCustomObjectivePool(positions)) {
        return computeCustomObjectivePoolHeadcount(positions, cycleKey);
    }

    const has24 = positions.some(is24hsRotationPosition);
    const hasCustom = positions.some(isCustomCoverPosition);
    if (has24 && hasCustom) {
        let total = 0;
        const customPositions: V2PositionDef[] = [];
        for (const pos of positions) {
            if (isCustomCoverPosition(pos)) {
                customPositions.push(pos);
                continue;
            }
            if (is24hsRotationPosition(pos)) {
                total += computePositionRequiredHeadcount(pos, cycleKey);
                continue;
            }
            total += computePositionRequiredHeadcount(pos, cycleKey);
        }
        if (customPositions.length > 0) {
            total += computeCustomObjectivePoolHeadcount(customPositions, cycleKey);
        }
        return total;
    }

    return positions.reduce(
        (sum, pos) => sum + computePositionRequiredHeadcount(pos, cycleKey),
        0,
    );
}

export function buildPositionRequiredHeadcountMap(
    positions: V2PositionDef[],
    cycleKey: string = '6+2',
): Record<string, number> {
    const pool = isFullCustomObjectivePool(positions);
    const map: Record<string, number> = {};
    for (const pos of positions) {
        map[pos.positionName] = pool
            ? customCoverSimultaneousPax(pos)
            : computePositionRequiredHeadcount(pos, cycleKey);
    }
    return map;
}
