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
    isFullCustomObjectivePool,
} from './objectiveHeadcount';
import { is24hsPosition } from './scheduleObjectiveFlags';
import { empMayJoinPositionRoster } from './slaContractPlanning';
import { empHasPositionAssignmentRestriction } from './positionAssignmentPolicy';

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
    positionAssignmentsByEmp?: Record<string, Array<{ positionName: string; shiftCodes: string[] }>>;
}

export interface ResolveObjectiveRosterResult {
    positionGroups: Record<string, string[]>;
    empAssignedTo: Record<string, string | null>;
    /** Guardias asignados en fase virtual (sin defaultPositionByEmp previo). */
    virtualAssignmentCount: number;
    phasedByKind: boolean;
    /** Puestos custom sin titular por restricción de cobertura SLA. */
    rosterWarnings: string[];
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
            if (have >= need) continue;
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
 * Custom pool (Shopping): cada puesto con cupo SLA debe tener titular(es) en el roster.
 * Si cobertura de dotación no lista un legajo para Salon 1/2, etc., usa comodines sin restricción SLA.
 */
function ensureCustomPoolMinimumTitulars(params: {
    positions: V2PositionDef[];
    positionNeed: Record<string, number>;
    positionGroups: Record<string, string[]>;
    empAssignedTo: Record<string, string | null>;
    sortedEmps: V2EmployeeDef[];
    positionAssignmentsByEmp?: ResolveObjectiveRosterParams['positionAssignmentsByEmp'];
}): string[] {
    const warnings: string[] = [];
    if (!isFullCustomObjectivePool(params.positions)) return warnings;

    const rosterCtx = { positionAssignmentsByEmp: params.positionAssignmentsByEmp };

    for (const pos of params.positions) {
        if (!isCustomCoverPosition(pos)) continue;
        const need = Math.max(1, params.positionNeed[pos.positionName] ?? 1);
        const group = params.positionGroups[pos.positionName] ?? [];
        let gap = need - group.length;
        if (gap <= 0) continue;

        const candidates = params.sortedEmps.filter((e) => {
            if (group.includes(e.id)) return false;
            const assignedPos = params.empAssignedTo[e.id];
            if (assignedPos) return false;
            return true;
        });

        while (gap > 0) {
            const pick =
                candidates.find((e) => empMayJoinPositionRoster(rosterCtx, e.id, pos.positionName))
                ?? candidates.find((e) => !empHasPositionAssignmentRestriction(rosterCtx, e.id))
                ?? candidates[0];

            if (!pick) {
                warnings.push(
                    `«${pos.positionName}»: sin titular en roster (faltan ${gap}); revisá Cobertura de dotación en SLA.`,
                );
                break;
            }

            group.push(pick.id);
            params.empAssignedTo[pick.id] = pos.positionName;
            const idx = candidates.indexOf(pick);
            if (idx >= 0) candidates.splice(idx, 1);
            gap--;
        }
    }

    return warnings;
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
        userLockedPos,
        empMeta: _empMeta,
        perPositionMonthHours,
        hardMax,
        overcapFactor,
    } = params;

    const rosterCtx = { positionAssignmentsByEmp: params.positionAssignmentsByEmp };
    const canJoin = (empId: string, posName: string) =>
        empMayJoinPositionRoster(rosterCtx, empId, posName);

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

    // 1a — puesto fijo EXPLÍCITO (planificacionDotacion / defaultPositionByEmp del usuario).
    // El rosterSeed del Auto Lab (defaultPos sin userLockedPos) NO bloquea: en mixtos
    // custom+24hs debe poder cerrar 24hs antes que custom aunque el seed liste custom primero.
    for (const emp of sortedEmps) {
        const fixed = userLockedPos[emp.id];
        if (!fixed || positionGroups[fixed] === undefined) continue;
        if (!canJoin(emp.id, fixed)) continue;
        assign(emp.id, fixed, false);
    }

    const fillPass = (candidates: V2PositionDef[]) => {
        for (const emp of sortedEmps) {
            if (empAssignedTo[emp.id] !== undefined) continue;
            const target = pickPositionWithLargestGap(candidates, positionGroups, positionNeed);
            if (!target) continue;
            if (!canJoin(emp.id, target)) continue;
            const pos = positions.find((p) => p.positionName === target);
            if (!pos) continue;
            const monthH = perPositionMonthHours[pos.positionName] ?? 0;
            const need = effectivePositionGroupNeed(pos, positionNeed, monthH, hardMax);
            const have = positionGroups[target].length;
            if (isLabSyntheticEmpId(emp.id) && have >= need) {
                empAssignedTo[emp.id] = null;
                continue;
            }
            assign(emp.id, target, !userLockedPos[emp.id]);
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
        if (target && canJoin(emp.id, target)) {
            const pos = positions.find((p) => p.positionName === target);
            const monthH = perPositionMonthHours[pos?.positionName ?? ''] ?? 0;
            const need = pos
                ? effectivePositionGroupNeed(pos, positionNeed, monthH, hardMax)
                : (positionNeed[target] || 1);
            const have = positionGroups[target].length;
            if (have >= need) {
                empAssignedTo[emp.id] = null;
                continue;
            }
            assign(emp.id, target, !userLockedPos[emp.id]);
        } else {
            empAssignedTo[emp.id] = null;
        }
    }

    const rosterWarnings = ensureCustomPoolMinimumTitulars({
        positions,
        positionNeed,
        positionGroups,
        empAssignedTo,
        sortedEmps,
        positionAssignmentsByEmp: params.positionAssignmentsByEmp,
    });

    return {
        positionGroups,
        empAssignedTo,
        virtualAssignmentCount,
        phasedByKind,
        rosterWarnings,
    };
}
