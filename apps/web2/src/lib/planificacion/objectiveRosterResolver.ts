/**
 * Resolución de dotación por tipo de puesto (fase 0 del cerebro).
 *
 * Orden en objetivos mixtos (24hs + custom):
 *  1. Legajos con puesto fijo (defaultPositionByEmp / planificacionDotacion)
 *  2. Completar cupo 24hs (rotación M→T→N, 6+2)
 *  3. Completar cupo custom (MA/ME L–V, etc.)
 *  4. Refuerzo / ocioso
 */
import type { V2EmployeeDef, V2PositionDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition } from './autoScheduleEngineV2';
import {
    effectivePositionGroupNeed,
    isLabSyntheticEmpId,
} from './objectiveHeadcount';
import { is24hsPosition } from './scheduleObjectiveFlags';

export type PositionScheduleKind = '24hs' | 'custom' | 'other';

/** Objetivo con al menos un puesto 24hs y uno custom (ej. Casa Matriz). */
export function objectiveHasMixedScheduleKinds(positions: V2PositionDef[]): boolean {
    return positions.some(is24hsPosition) && positions.some(isCustomCoverPosition);
}

export function positionScheduleKind(pos: V2PositionDef): PositionScheduleKind {
    if (is24hsPosition(pos)) return '24hs';
    if (isCustomCoverPosition(pos)) return 'custom';
    return 'other';
}

/** Prioridad de llenado: 24hs antes que custom u otros. */
const KIND_FILL_ORDER: PositionScheduleKind[] = ['24hs', 'custom', 'other'];

export interface ResolveObjectiveRosterParams {
    positions: V2PositionDef[];
    sortedEmps: V2EmployeeDef[];
    positionNeed: Record<string, number>;
    defaultPos: Record<string, string>;
    userLockedPos: Record<string, string>;
    empMeta: Record<string, { priorityScore: number }>;
    perPositionMonthHours: Record<string, number>;
    hardMax: number;
    overcapFactor: number;
    /** Si false, usa reparto por mayor brecha (legacy) sin priorizar 24hs. */
    phasedByKind?: boolean;
}

export interface ResolveObjectiveRosterResult {
    positionGroups: Record<string, string[]>;
    empAssignedTo: Record<string, string | null>;
    /** Guardias asignados en fase virtual (sin defaultPositionByEmp previo). */
    virtualAssignmentCount: number;
    phasedByKind: boolean;
}

function initEmptyGroups(positions: V2PositionDef[]): Record<string, string[]> {
    const groups: Record<string, string[]> = {};
    for (const p of positions) {
        groups[p.positionName] = [];
    }
    return groups;
}

function pickPositionWithLargestGap(
    candidates: V2PositionDef[],
    positionGroups: Record<string, string[]>,
    positionNeed: Record<string, number>,
): string | null {
    let target: string | null = null;
    let maxGap = 0;
    for (const pos of candidates) {
        const need = positionNeed[pos.positionName] || 0;
        const have = positionGroups[pos.positionName]?.length ?? 0;
        const gap = need - have;
        if (gap > maxGap) {
            maxGap = gap;
            target = pos.positionName;
        }
    }
    return maxGap > 0 ? target : null;
}

function pickReinforcementPosition(
    positions: V2PositionDef[],
    positionGroups: Record<string, string[]>,
    positionNeed: Record<string, number>,
    perPositionMonthHours: Record<string, number>,
    hardMax: number,
    overcapFactor: number,
    phasedByKind: boolean,
): string | null {
    let target: string | null = null;
    let minRatio = Infinity;

    const tryPositions = (list: V2PositionDef[]) => {
        for (const pos of list) {
            const monthH = perPositionMonthHours[pos.positionName] ?? 0;
            const need = effectivePositionGroupNeed(pos, positionNeed, monthH, hardMax);
            const have = positionGroups[pos.positionName]?.length ?? 0;
            const ratio = have / Math.max(1, need);
            if (ratio < overcapFactor && ratio < minRatio) {
                minRatio = ratio;
                target = pos.positionName;
            }
        }
    };

    if (phasedByKind) {
        for (const kind of KIND_FILL_ORDER) {
            tryPositions(positions.filter((p) => positionScheduleKind(p) === kind));
            if (target) return target;
        }
        return null;
    }

    tryPositions(positions);
    return target;
}

/**
 * Asigna cada guardia a un único puesto del mes (o idle).
 * En mixtos, el pool 24hs se cierra antes de tocar custom.
 */
export function resolveObjectivePositionRoster(
    params: ResolveObjectiveRosterParams,
): ResolveObjectiveRosterResult {
    const {
        positions,
        sortedEmps,
        positionNeed,
        defaultPos,
        userLockedPos: _userLockedPos,
        empMeta: _empMeta,
        perPositionMonthHours,
        hardMax,
        overcapFactor,
    } = params;

    const phasedByKind = params.phasedByKind ?? objectiveHasMixedScheduleKinds(positions);
    const positionGroups = initEmptyGroups(positions);
    const empAssignedTo: Record<string, string | null> = {};
    let virtualAssignmentCount = 0;

    const assign = (empId: string, posName: string, wasVirtual: boolean) => {
        if (!positionGroups[posName]) return;
        positionGroups[posName].push(empId);
        empAssignedTo[empId] = posName;
        if (wasVirtual) virtualAssignmentCount++;
    };

    // 1a — puesto fijo desde UI / planificacionDotacion
    for (const emp of sortedEmps) {
        const fixed = defaultPos[emp.id];
        if (!fixed || positionGroups[fixed] === undefined) continue;
        assign(emp.id, fixed, false);
    }

    const fillPass = (candidates: V2PositionDef[]) => {
        for (const emp of sortedEmps) {
            if (empAssignedTo[emp.id] !== undefined) continue;
            const target = pickPositionWithLargestGap(candidates, positionGroups, positionNeed);
            if (!target) continue;
            const pos = positions.find((p) => p.positionName === target);
            if (!pos) continue;
            const monthH = perPositionMonthHours[pos.positionName] ?? 0;
            const need = effectivePositionGroupNeed(pos, positionNeed, monthH, hardMax);
            const have = positionGroups[target].length;
            if (isLabSyntheticEmpId(emp.id) && have >= need) {
                empAssignedTo[emp.id] = null;
                continue;
            }
            assign(emp.id, target, !defaultPos[emp.id]);
        }
    };

    if (phasedByKind) {
        for (const kind of KIND_FILL_ORDER) {
            const bucket = positions.filter((p) => positionScheduleKind(p) === kind);
            if (bucket.length === 0) continue;
            fillPass(bucket);
        }
    } else {
        fillPass(positions);
    }

    // 1c — refuerzo cuando todos los cupos estructurales están cubiertos
    for (const emp of sortedEmps) {
        if (empAssignedTo[emp.id] !== undefined) continue;
        const target = pickReinforcementPosition(
            positions,
            positionGroups,
            positionNeed,
            perPositionMonthHours,
            hardMax,
            overcapFactor,
            phasedByKind,
        );
        if (target) {
            const pos = positions.find((p) => p.positionName === target);
            const monthH = perPositionMonthHours[pos?.positionName ?? ''] ?? 0;
            const need = pos
                ? effectivePositionGroupNeed(pos, positionNeed, monthH, hardMax)
                : (positionNeed[target] || 1);
            const have = positionGroups[target].length;
            if (isLabSyntheticEmpId(emp.id) && have >= need) {
                empAssignedTo[emp.id] = null;
                continue;
            }
            assign(emp.id, target, !defaultPos[emp.id]);
        } else {
            empAssignedTo[emp.id] = null;
        }
    }

    return {
        positionGroups,
        empAssignedTo,
        virtualAssignmentCount,
        phasedByKind,
    };
}
