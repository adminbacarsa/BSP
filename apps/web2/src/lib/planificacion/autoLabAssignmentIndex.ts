import type { V2GenerateResult } from './autoScheduleEngineV2';

export function buildAssignmentIndex(
    assignments: V2GenerateResult['assignments'],
): Map<string, Map<string, V2GenerateResult['assignments'][number][]>> {
    const byEmp = new Map<string, Map<string, V2GenerateResult['assignments'][number][]>>();
    for (const a of assignments) {
        if (!byEmp.has(a.empId)) byEmp.set(a.empId, new Map());
        const byDay = byEmp.get(a.empId)!;
        if (!byDay.has(a.dateStr)) byDay.set(a.dateStr, []);
        byDay.get(a.dateStr)!.push(a);
    }
    return byEmp;
}

/** Puesto principal por guardia (motor positionGroups; sin inferir puesto para ociosos). */
export function buildEmployeePositionMap(
    employees: { id: string }[],
    assignments: V2GenerateResult['assignments'],
    positionGroups?: Record<string, string[]>,
    idleEmployeeIds?: string[],
): Record<string, string> {
    const map: Record<string, string> = {};
    const idleSet = new Set(idleEmployeeIds ?? []);

    if (positionGroups) {
        for (const [posName, ids] of Object.entries(positionGroups)) {
            for (const id of ids) map[id] = posName;
        }
    }

    const counts: Record<string, Record<string, number>> = {};
    for (const a of assignments) {
        if (!a.positionName || (a.hours ?? 0) <= 0) continue;
        if (!counts[a.empId]) counts[a.empId] = {};
        counts[a.empId][a.positionName] = (counts[a.empId][a.positionName] || 0) + 1;
    }
    for (const emp of employees) {
        if (map[emp.id] || idleSet.has(emp.id)) continue;
        const tallies = counts[emp.id];
        if (!tallies) continue;
        let best = '';
        let bestN = 0;
        for (const [pos, n] of Object.entries(tallies)) {
            if (n > bestN) {
                bestN = n;
                best = pos;
            }
        }
        if (best) map[emp.id] = best;
    }
    return map;
}
