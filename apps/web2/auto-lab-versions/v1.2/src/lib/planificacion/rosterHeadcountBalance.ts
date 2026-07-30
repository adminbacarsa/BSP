/**
 * Balance dotación vs plantilla SLA: déficit → advertir + pad sintético;
 * excedente → guardias ociosos en RET (días laborables del ciclo) / F (francos).
 */

import type { V2EmployeeDef, V2PositionDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition } from './autoScheduleEngineV2';
import { trim24hsPositionGroupsToNeed } from './multipax24hsRotation';
import {
    computeObjectiveRequiredHeadcount,
    computePositionRequiredHeadcount,
    isLabSyntheticEmpId,
} from './objectiveHeadcount';

export type HeadcountBalanceStatus = 'ok' | 'deficit' | 'surplus';

export interface ObjectiveHeadcountBalance {
    needed: number;
    available: number;
    realCount: number;
    syntheticCount: number;
    delta: number;
    status: HeadcountBalanceStatus;
    messages: string[];
}

export function countRealEmployees(employees: V2EmployeeDef[]): number {
    return employees.filter((e) => !isLabSyntheticEmpId(e.id)).length;
}

export function computeObjectiveHeadcountBalance(params: {
    positions: V2PositionDef[];
    employees: V2EmployeeDef[];
    cycleKey?: string;
}): ObjectiveHeadcountBalance {
    const { positions, employees, cycleKey = '6+2' } = params;
    const needed = computeObjectiveRequiredHeadcount(positions, cycleKey);
    const realCount = countRealEmployees(employees);
    const syntheticCount = employees.length - realCount;
    const available = employees.length;
    const delta = available - needed;

    const messages: string[] = [];
    let status: HeadcountBalanceStatus = 'ok';

    if (delta < 0) {
        status = 'deficit';
        messages.push(
            `DÉFICIT DOTACIÓN: faltan ${-delta} guardia(s) respecto a la plantilla SLA `
            + `(${realCount} legajos reales / ${needed} requeridos, ciclo ${cycleKey}). `
            + `Se agregarán guardias sintéticos RET/sin turno para completar estructura.`,
        );
    } else if (delta > 0) {
        status = 'surplus';
        messages.push(
            `EXCESO DOTACIÓN: sobran ${delta} guardia(s) respecto a la plantilla SLA `
            + `(${available} disponibles / ${needed} requeridos). `
            + `El excedente queda en RET (días laborables) y Franco (descanso de ciclo), sin turnos facturables.`,
        );
    }

    if (syntheticCount > 0) {
        messages.push(
            `${syntheticCount} guardia(s) sintético(s) en roster (completar dotación / stand-by RET).`,
        );
    }

    return {
        needed,
        available,
        realCount,
        syntheticCount,
        delta,
        status,
        messages,
    };
}

/** Todos los ociosos + sintéticos lab-pad sin puesto → pool RET (no turnos facturables). */
export function buildSurplusRetEmployeeSet(params: {
    employees: V2EmployeeDef[];
    idleEmployeeIds: string[];
}): Set<string> {
    const set = new Set<string>(params.idleEmployeeIds);
    for (const emp of params.employees) {
        if (isLabSyntheticEmpId(emp.id)) set.add(emp.id);
    }
    return set;
}

export function surplusRetEmployeeIds(set: Set<string>): string[] {
    return [...set];
}

/**
 * Recorta grupos al cupo estructural por puesto y deja ociosos al excedente de plantilla.
 * Prioriza mantener legajos con dotación explícita (userLockedPos); el sobrante va a RET.
 */
export function enforceObjectiveRosterCaps(params: {
    positions: V2PositionDef[];
    positionGroups: Record<string, string[]>;
    empAssignedTo: Record<string, string | null>;
    positionNeed: Record<string, number>;
    employees: V2EmployeeDef[];
    empMeta?: Record<string, { priorityScore: number }>;
    userLockedPos?: Record<string, string>;
    cycleKey?: string;
}): string[] {
    const {
        positions,
        positionGroups,
        empAssignedTo,
        positionNeed,
        employees,
        empMeta,
        userLockedPos,
        cycleKey = '6+2',
    } = params;

    const capFor = (pos: V2PositionDef) =>
        Math.max(1, positionNeed[pos.positionName] ?? computePositionRequiredHeadcount(pos, cycleKey));

    const removeLowestFromGroup = (posName: string, cap: number) => {
        const group = positionGroups[posName] ?? [];
        while (group.length > cap) {
            const byScore = [...group].sort((a, b) => {
                const lockA = userLockedPos?.[a] === posName ? 1 : 0;
                const lockB = userLockedPos?.[b] === posName ? 1 : 0;
                if (lockA !== lockB) return lockA - lockB;
                const synthA = isLabSyntheticEmpId(a) ? -1 : 0;
                const synthB = isLabSyntheticEmpId(b) ? -1 : 0;
                if (synthA !== synthB) return synthA - synthB;
                return (empMeta?.[a]?.priorityScore ?? 0) - (empMeta?.[b]?.priorityScore ?? 0);
            });
            const removeId = byScore[0];
            if (!removeId) break;
            const idx = group.indexOf(removeId);
            if (idx >= 0) group.splice(idx, 1);
            empAssignedTo[removeId] = null;
        }
    };

    for (const pos of positions) {
        removeLowestFromGroup(pos.positionName, capFor(pos));
    }

    trim24hsPositionGroupsToNeed(
        positions,
        positionGroups,
        empAssignedTo,
        positionNeed,
        cycleKey,
    );

    const plantilla = computeObjectiveRequiredHeadcount(positions, cycleKey);
    const assignedIds = employees
        .map((e) => e.id)
        .filter((id) => empAssignedTo[id] !== null && empAssignedTo[id] !== undefined);
    let surplus = assignedIds.length - plantilla;
    if (surplus > 0) {
        const candidates = [...assignedIds].sort((a, b) => {
            const lockA = userLockedPos?.[a] ? 1 : 0;
            const lockB = userLockedPos?.[b] ? 1 : 0;
            if (lockA !== lockB) return lockA - lockB;
            return (empMeta?.[a]?.priorityScore ?? 0) - (empMeta?.[b]?.priorityScore ?? 0);
        });
        for (const empId of candidates) {
            if (surplus <= 0) break;
            const posName = empAssignedTo[empId];
            if (!posName) continue;
            const group = positionGroups[posName];
            if (!group) continue;
            const idx = group.indexOf(empId);
            if (idx >= 0) group.splice(idx, 1);
            empAssignedTo[empId] = null;
            surplus -= 1;
        }
    }

    return employees.filter((e) => empAssignedTo[e.id] === null).map((e) => e.id);
}
