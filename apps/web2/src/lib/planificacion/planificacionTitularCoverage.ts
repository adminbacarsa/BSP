import { isOpsCoverageShift, shiftMatchesObjective } from '@/lib/planificacion/planificacionPlanningShiftRules';

/** Códigos de celda que representan licencia/ausencia (no turno de cobertura). */
export const LEAVE_CELL_CODES = new Set(['V', 'L', 'PG', 'A', 'ART', 'E', 'AA', 'LT', 'SGS', 'SUS']);

export function resolveTitularCoverageName(
    titularEmpId: string,
    titularName: string,
    dateStr: string,
    shiftsMap: Record<string, any>,
    pendingChanges: Record<string, any>,
    empNameById: (id: string) => string | undefined,
    coveredByFromCell?: string | null,
    cellTurnosMap?: Record<string, any[]>,
    objectiveIdHint?: string | null,
    positionHint?: string | null,
    codeHint?: string | null,
): string | null {
    if (coveredByFromCell) {
        return String(coveredByFromCell).replace(/\s*\([^)]*\)\s*$/, '').trim() || null;
    }
    const titularLastName = titularName.split(',')[0]?.trim().toLowerCase() || titularName.toLowerCase();
    const candidates: any[] = [];
    if (cellTurnosMap) {
        for (const [k, arr] of Object.entries(cellTurnosMap)) {
            if (!k.endsWith(`_${dateStr}`) || k.startsWith(`${titularEmpId}_`)) continue;
            if (Array.isArray(arr)) {
                for (const item of arr) {
                    if (item && !item.isDeleted && !candidates.some(c => c.id === item.id)) {
                        candidates.push(item);
                    }
                }
            }
        }
    }
    const allSources = { ...shiftsMap, ...pendingChanges };
    for (const [k, raw] of Object.entries(allSources)) {
        if (!k.endsWith(`_${dateStr}`) || k.startsWith(`${titularEmpId}_`)) continue;
        const s = raw as any;
        if (s && !s.isDeleted && !candidates.some(c => c.id === s.id)) {
            candidates.push(s);
        }
    }

    const titularKey = `${titularEmpId}_${dateStr}`;
    const titularDoc = (pendingChanges[titularKey] || shiftsMap[titularKey]) as any;
    const ledgerEventId = String(titularDoc?.coverageEventId || '').trim();

    for (const s of candidates) {
        // No tratar docs VACANTE_POR_AUSENCIA como el cubridor
        if (s.employeeId === 'VACANTE' || s.isUnassigned === true) continue;
        const origin = String(s.origin || '').toUpperCase();
        if (origin.startsWith('VACANTE_') || origin === 'SLA_VIRTUAL') continue;

        if (ledgerEventId && String(s.coverageEventId || '') === ledgerEventId) {
            const name = s.employeeName || empNameById(s.employeeId);
            const covCode = String(s.code || '').toUpperCase();
            if (name && covCode && !LEAVE_CELL_CODES.has(covCode)) return `${name} turno ${covCode}`;
            return name || null;
        }

        const coversName = String(s.coversAbsenceEmployeeName || s.absenceEmployeeName || s.coveredEmployeeName || '').toLowerCase();
        const coversEmpId = String(s.coversEmployeeId || '');
        const comments = String(s.comments || '').toLowerCase();

        const matchesName = coversName && (coversName.includes(titularLastName) || titularName.toLowerCase().includes(coversName));
        const matchesId = coversEmpId && coversEmpId === titularEmpId;
        const matchesComments = comments.includes(`cubriendo a ${titularName.toLowerCase()}`)
            || comments.includes(`cubre a ${titularName.toLowerCase()}`)
            || (titularLastName.length > 2 && comments.includes(`cubre ${titularLastName}`))
            || (titularLastName.length > 2 && comments.includes(`cubre: ${titularLastName}`));

        if (matchesName || matchesId || matchesComments) {
            const name = s.employeeName || empNameById(s.employeeId);
            const covCode = String(s.code || '').toUpperCase();
            if (name && covCode && !LEAVE_CELL_CODES.has(covCode)) return `${name} turno ${covCode}`;
            return name || null;
        }
    }

    if (objectiveIdHint) {
        const matchingOps = candidates.filter(c => isOpsCoverageShift(c) && shiftMatchesObjective(c, objectiveIdHint));
        const matched = (codeHint && matchingOps.find(c => String(c.code || '').toUpperCase() === codeHint.toUpperCase()))
            || (positionHint && positionHint !== 'General' && matchingOps.find(c => String(c.positionName || '').toLowerCase() === positionHint.toLowerCase()))
            || (matchingOps.length === 1 ? matchingOps[0] : null);
        if (matched) {
            const name = matched.employeeName || empNameById(matched.employeeId);
            const covCode = String(matched.code || codeHint || '').toUpperCase();
            if (name && covCode && !LEAVE_CELL_CODES.has(covCode)) return `${name} turno ${covCode}`;
            return name || null;
        }
    }

    return null;
}
