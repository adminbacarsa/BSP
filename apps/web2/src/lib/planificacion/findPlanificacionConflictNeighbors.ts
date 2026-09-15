import { getDateKey } from '@/lib/planificacion/utils';

export type PlanificacionConflictNeighbors = {
    prev: any | null;
    next: any | null;
};

export function findPlanificacionConflictNeighbors(
    problemShift: any,
    dateStr: string,
    shiftsMap: Record<string, any>,
    absencesMap: Record<string, any>,
    employees: any[],
): PlanificacionConflictNeighbors {
    const candidates: any[] = [];
    Object.values(shiftsMap).forEach((s: any) => {
        if (s.objectiveId === problemShift.objectiveId && getDateKey(s.startTime) === dateStr && s.id !== problemShift.id) {
            const key = `${s.employeeId}_${dateStr}`;
            if (!absencesMap[key]) {
                candidates.push({ ...s, employeeName: employees.find(e => e.id === s.employeeId)?.name || 'Desconocido' });
            }
        }
    });
    candidates.sort((a, b) => a.startTime.seconds - b.startTime.seconds);
    const myStart = problemShift.startTime.seconds;
    let prev: any | null = null;
    let next: any | null = null;
    for (const cand of candidates) {
        if (cand.startTime.seconds < myStart) prev = cand;
        if (cand.startTime.seconds > myStart && !next) next = cand;
    }
    return { prev, next };
}
