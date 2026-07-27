/**
 * Alineación de roster con sabiduría histórica: quién suele trabajar en cada puesto.
 * Solo aplica cuando la dotación explícita ya pasó validación estructural (conteos OK).
 */

import type { PlanningCoverageWisdom } from './planningCoverageWisdom';
import { positionAffinityScore } from './planningCoverageWisdom';

export interface WisdomRosterSwap {
    empIdA: string;
    empIdB: string;
    fromPositionA: string;
    fromPositionB: string;
    reason: string;
    scoreGain: number;
}

export interface WisdomRosterAlignmentResult {
    appliedSwaps: WisdomRosterSwap[];
    suggestions: WisdomRosterSwap[];
    warnings: string[];
}

function affinity(
    empId: string,
    positionName: string,
    wisdom: PlanningCoverageWisdom | null | undefined,
): number {
    return positionAffinityScore(empId, positionName, wisdom);
}

/**
 * Intercambia guardias entre dos puestos si mejora afinidad histórica sin cambiar cupos.
 * Solo muta `positionGroups` y `empAssignedTo` cuando `apply === true`.
 */
export function alignPositionGroupsWithWisdom(params: {
    positionGroups: Record<string, string[]>;
    empAssignedTo: Record<string, string | null>;
    positionNames: string[];
    wisdom: PlanningCoverageWisdom | null | undefined;
    userLockedPos?: Record<string, string>;
    apply?: boolean;
    minScoreGain?: number;
}): WisdomRosterAlignmentResult {
    const {
        positionGroups,
        empAssignedTo,
        positionNames,
        wisdom,
        userLockedPos = {},
        apply = true,
        minScoreGain = 8,
    } = params;

    const appliedSwaps: WisdomRosterSwap[] = [];
    const suggestions: WisdomRosterSwap[] = [];
    const warnings: string[] = [];

    if (!wisdom?.employeeProfiles || Object.keys(wisdom.employeeProfiles).length === 0) {
        warnings.push('Sin perfiles de sabiduría — no se ajusta quién va a cada puesto.');
        return { appliedSwaps, suggestions, warnings };
    }

    const locked = (empId: string) => !!userLockedPos[empId];

    const swapInGroups = (empA: string, posA: string, empB: string, posB: string) => {
        const gA = positionGroups[posA];
        const gB = positionGroups[posB];
        if (!gA || !gB) return;
        const iA = gA.indexOf(empA);
        const iB = gB.indexOf(empB);
        if (iA < 0 || iB < 0) return;
        gA[iA] = empB;
        gB[iB] = empA;
        empAssignedTo[empA] = posB;
        empAssignedTo[empB] = posA;
    };

    let improved = true;
    let passes = 0;
    while (improved && passes < 12) {
        improved = false;
        passes += 1;

        for (let i = 0; i < positionNames.length; i++) {
            for (let j = i + 1; j < positionNames.length; j++) {
                const posA = positionNames[i];
                const posB = positionNames[j];
                const groupA = positionGroups[posA] || [];
                const groupB = positionGroups[posB] || [];

                for (const empA of groupA) {
                    if (locked(empA)) continue;
                    for (const empB of groupB) {
                        if (locked(empB)) continue;

                        const before =
                            affinity(empA, posA, wisdom) + affinity(empB, posB, wisdom);
                        const after =
                            affinity(empA, posB, wisdom) + affinity(empB, posA, wisdom);
                        const gain = after - before;
                        if (gain < minScoreGain) continue;

                        const swap: WisdomRosterSwap = {
                            empIdA: empA,
                            empIdB: empB,
                            fromPositionA: posA,
                            fromPositionB: posB,
                            scoreGain: gain,
                            reason: `Historial: mejor afinidad cruzada ${posA}↔${posB} (+${gain})`,
                        };

                        if (apply) {
                            swapInGroups(empA, posA, empB, posB);
                            appliedSwaps.push(swap);
                            improved = true;
                        } else {
                            suggestions.push(swap);
                        }
                    }
                }
            }
        }
    }

    if (appliedSwaps.length > 0) {
        warnings.push(
            `Sabiduría histórica: ${appliedSwaps.length} intercambio(s) entre puestos `
            + `para alinear guardias con dónde suelen trabajar.`,
        );
    }

    return { appliedSwaps, suggestions, warnings };
}

/** Guardias con baja afinidad al puesto asignado en dotación (para aviso al planificador). */
export function findLowAffinityDotacionWarnings(params: {
    defaultPositionByEmp: Record<string, string>;
    wisdom: PlanningCoverageWisdom | null | undefined;
    affinityThreshold?: number;
}): string[] {
    const { defaultPositionByEmp, wisdom, affinityThreshold = 15 } = params;
    const out: string[] = [];
    if (!wisdom?.employeeProfiles) return out;

    for (const [empId, posName] of Object.entries(defaultPositionByEmp)) {
        const score = affinity(empId, posName, wisdom);
        if (score >= affinityThreshold) continue;

        const prof = wisdom.employeeProfiles[empId];
        if (!prof || prof.totalWorkDays < 5) continue;

        const best = Object.entries(prof.byPosition)
            .sort(([, a], [, b]) => b - a)[0];
        if (!best || best[0] === posName) continue;
        if (best[1] < 5) continue;

        const pct = Math.round((best[1] / prof.totalWorkDays) * 100);
        out.push(
            `Dotación: guardia en «${posName}» pero el historial muestra más trabajo en `
            + `«${best[0]}» (~${pct}% de días). Revisá planificacionDotacion o dejá que la sabiduría corrija.`,
        );
    }
    return out;
}
