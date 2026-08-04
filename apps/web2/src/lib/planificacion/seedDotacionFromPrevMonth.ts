/**
 * Semilla de puesto/banda para Automatizar desde turnos publicados del mes anterior.
 */

import type { PlanningShiftCell } from './planningCoverageWisdom';

const NON_WORK = new Set([
    'F', 'FF', 'FP', 'FT', 'RET', 'R', 'V', 'L', 'E', 'A', 'PG', 'AA',
]);

const BAND_CODES = new Set(['M', 'T', 'N', 'D12', 'N12']);

function pickDominant(counts: Record<string, number>): string | undefined {
    let best = '';
    let n = 0;
    for (const [k, v] of Object.entries(counts)) {
        if (v > n) {
            n = v;
            best = k;
        }
    }
    return best || undefined;
}

export function dominantDotacionFromPlanningCells(
    cells: PlanningShiftCell[],
    objectiveId: string,
    rosterEmployeeIds: Set<string>,
): { positionByEmp: Record<string, string>; shiftByEmp: Record<string, string> } {
    const positionByEmp: Record<string, string> = {};
    const shiftByEmp: Record<string, string> = {};
    const posCounts: Record<string, Record<string, number>> = {};
    const bandCounts: Record<string, Record<string, number>> = {};

    for (const cell of cells) {
        if (cell.objectiveId !== objectiveId) continue;
        if (!rosterEmployeeIds.has(cell.employeeId)) continue;
        const code = String(cell.code || '').toUpperCase().trim();
        if (!code || NON_WORK.has(code)) continue;

        const pos = String(cell.positionName || '').trim();
        if (pos) {
            if (!posCounts[cell.employeeId]) posCounts[cell.employeeId] = {};
            posCounts[cell.employeeId][pos] = (posCounts[cell.employeeId][pos] || 0) + 1;
        }

        if (BAND_CODES.has(code)) {
            if (!bandCounts[cell.employeeId]) bandCounts[cell.employeeId] = {};
            bandCounts[cell.employeeId][code] = (bandCounts[cell.employeeId][code] || 0) + 1;
        }
    }

    for (const empId of rosterEmployeeIds) {
        const domPos = pickDominant(posCounts[empId] || {});
        const domBand = pickDominant(bandCounts[empId] || {});
        if (domPos) positionByEmp[empId] = domPos;
        if (domBand) shiftByEmp[empId] = domBand;
    }

    return { positionByEmp, shiftByEmp };
}
