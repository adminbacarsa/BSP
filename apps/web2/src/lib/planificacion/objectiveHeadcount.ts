import type { V2PositionDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition } from './autoScheduleEngineV2';

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
 * ## Puesto custom (MA, ME, horario fijo L–V u otro)
 * - `qty` = guardias en el **mismo turno en simultáneo**.
 * - **No aplica** esquema 6+2 ni otro ciclo CCT: solo días/horas del SLA (activeDays + turno fijo).
 * - Francos solo en días no operativos del puesto o por ausencia planificada.
 */
export function computePositionRequiredHeadcount(
    pos: V2PositionDef,
    cycleKey: string = '6+2',
): number {
    const qty = Math.max(1, Number(pos.qty) || 1);

    if (isCustomCoverPosition(pos)) {
        return qty;
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

export function computeObjectiveRequiredHeadcount(
    positions: V2PositionDef[],
    cycleKey: string = '6+2',
): number {
    return positions.reduce(
        (sum, pos) => sum + computePositionRequiredHeadcount(pos, cycleKey),
        0,
    );
}

export function buildPositionRequiredHeadcountMap(
    positions: V2PositionDef[],
    cycleKey: string = '6+2',
): Record<string, number> {
    const map: Record<string, number> = {};
    for (const pos of positions) {
        map[pos.positionName] = computePositionRequiredHeadcount(pos, cycleKey);
    }
    return map;
}
