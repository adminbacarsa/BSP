import type { GrupoObjetivos } from '@/services/gruposService';
import { isOperationalOriginShift as isCanonicalOperationalOriginShift } from '@/lib/shifts/operationalShift';

/**
 * Overlay de la grilla de planificación: operativo canónico + relevo, salvo
 * celdas ya cubiertas o con titular ausente (esas siguen mostrando el crono).
 * No reutilizar este nombre para visibilidad Ops / horas / publicación.
 */
export function isPlanningGridOperationalShift(data: any): boolean {
    if (!data) return false;
    if (data?.operacionallyCovered === true || data?.coveredBy || data?.coveredByEmployeeName || data?.isAbsent === true) return false;
    return isCanonicalOperationalOriginShift(data) || data?.isRelief === true;
}

/** Comprueba si el turno coincide con el objetivo (directo o por cobertura/franco/redirección). */
export function shiftMatchesObjective(data: any, objectiveId: string | undefined | null): boolean {
    if (!data || !objectiveId) return false;
    const target = String(objectiveId);
    if (data.objectiveId && String(data.objectiveId) === target) return true;
    if (data.francoObjectiveId && String(data.francoObjectiveId) === target) return true;
    if (data.coverageRedirectedTo && String(data.coverageRedirectedTo) === target) return true;
    return false;
}

/** Cobertura operativa: se muestra en grilla (visual) pero no suma CCT. */
export function isOpsCoverageShift(data: any): boolean {
    if (!data) return false;
    if (data?.operacionallyCovered === true || data?.isAbsent === true) return false;
    const o = String(data?.origin || '').toUpperCase();
    if (o === 'OPERATIONS_COVERAGE' || o === 'RETEN') return true;
    if (data?.isReten === true || data?.isRelief === true) return true;
    if (data?.isFrancoTrabajado && data?.francoObjectiveId) return true;
    if (data?.coverageRedirectedTo) return true;
    if (data?.coversAbsenceEmployeeName || data?.absenceShiftId || data?.coversEmployeeId) return true;
    if (data?.resolvedBy === 'OPERACIONES' && (o === 'OPERATIONS_COVERAGE' || o === 'RETEN' || data?.coversAbsenceEmployeeName || data?.absenceShiftId)) return true;
    if (String(data?.resolvedBy || '').toUpperCase() === 'MODO_DEMO' && (o === 'OPERATIONS_COVERAGE' || o === 'RETEN' || o === 'INTERCAMBIO')) return true;
    return false;
}

/**
 * Publicado = tiene publishedAt. El doc planificacion_estados también guarda
 * defaultPositionByEmp (asignación de puestos) sin publicar el cronograma.
 */
export function isPlanificacionPublished(
    status: { publishedAt?: unknown; publishedBy?: string } | null | undefined,
): boolean {
    return status != null && status.publishedAt != null && status.publishedAt !== '';
}

/**
 * Horas CCT / pie de grilla: solo turnos del objetivo en pantalla y NO operativos.
 * Los borradores (draft:true) sí cuentan — son el crono planificado todavía no publicado.
 */
export function turnoCuentaParaCronoPlanificado(data: any, objectiveId: string | undefined | null): boolean {
    if (!data || !objectiveId) return false;
    if (String(data.objectiveId || '') !== String(objectiveId)) return false;
    if (isPlanningGridOperationalShift(data)) return false;
    return true;
}

export const OTHER_OBJECTIVE_CELL_STYLE =
    'bg-slate-700 text-slate-200 border-slate-600 ring-2 ring-slate-500 ring-offset-2 dark:ring-offset-slate-900 font-bold opacity-90';

export function shiftPlanningCodeUpper(shift: any): string {
    return String(shift?.code || shift?.type || '').toUpperCase();
}

export function isShiftAtOtherObjective(
    s: any,
    p: any,
    selectedObjective: string | null | undefined,
): boolean {
    if (!selectedObjective) return false;
    if (p?.isDeleted) return false;
    const active = p && !p.isDeleted ? p : s;
    if (!active) return false;
    if (shiftMatchesObjective(active, selectedObjective)) return false;
    const obj = active.objectiveId;
    if (obj == null || obj === '') return false;
    return String(obj) !== String(selectedObjective);
}

/** Turno de otro objetivo: solo lectura en este crono, salvo RET y Franco (F/FF → flujo FT). */
export function isCrossObjectivePlanningReadOnly(
    shift: any,
    selectedObjective: string | null | undefined,
): boolean {
    if (!shift || !selectedObjective) return false;
    if (isPlanningGridOperationalShift(shift)) return true;
    if (shiftMatchesObjective(shift, selectedObjective)) return false;
    const obj = shift.objectiveId;
    if (obj == null || obj === '') return false;
    if (String(obj) === String(selectedObjective)) return false;
    const code = shiftPlanningCodeUpper(shift);
    if (code === 'RET') return false;
    if (code === 'F' || code === 'FF') return false;
    return true;
}

/** Turno guardado en Firestore de otro objetivo (solo visualización en el crono activo). */
export function pickCrossObjectiveSavedShift(
    rawS: any,
    selectedObjective: string | undefined | null,
): any | null {
    if (!rawS || !selectedObjective) return null;
    if (isPlanningGridOperationalShift(rawS)) return null;
    if (shiftMatchesObjective(rawS, selectedObjective)) return null;
    const obj = rawS.objectiveId;
    if (obj == null || obj === '') return null;
    if (String(obj) === String(selectedObjective)) return null;
    return rawS;
}

/** Busca cobertura operativa en la lista de turnos de la celda (emp+día). */
export function pickOpsCoverageFromCellTurnos(
    cellTurnos: any[] | undefined,
    selectedObjective: string | undefined | null,
    grupoObjectiveIds?: string[] | null,
): any | null {
    if (!cellTurnos?.length) return null;
    for (const t of cellTurnos) {
        if (!isOpsCoverageShift(t)) continue;
        if (grupoObjectiveIds?.length) {
            const tObj = String(t.objectiveId || t.francoObjectiveId || t.coverageRedirectedTo || '');
            if (grupoObjectiveIds.includes(tObj)) return t;
            continue;
        }
        if (shiftMatchesObjective(t, selectedObjective)) return t;
    }
    return null;
}

/** Turno visible en celda del crono para el objetivo activo (pending o publicado). */
export function resolveCellShiftAtObjective(
    empId: string,
    dateStr: string,
    selectedObjective: string | undefined | null,
    pendingChanges: Record<string, any>,
    shiftsMap: Record<string, any>,
): any | null {
    if (!selectedObjective) return null;
    const key = `${empId}_${dateStr}`;
    const pending = pendingChanges[key];
    const existing = shiftsMap[key];
    if (pending?.isDeleted) return null;
    const activeShift = pending && !pending.isDeleted ? pending : existing;
    if (!activeShift) return null;
    if (pending && !pending.isDeleted) {
        if (!shiftMatchesObjective(activeShift, selectedObjective)) return null;
        return activeShift;
    }
    if (
        isOpsCoverageShift(activeShift)
        && shiftMatchesObjective(activeShift, selectedObjective)
    ) {
        return activeShift;
    }
    if (!turnoCuentaParaCronoPlanificado(activeShift, selectedObjective)) return null;
    return activeShift;
}

/** Turno(s) visibles en celda según objetivo activo o grupo unificado. */
export function resolveCellShiftDisplay(
    empId: string,
    dateStr: string,
    selectedObjective: string | null | undefined,
    selectedGrupo: GrupoObjetivos | null | undefined,
    grupoUnifiedMode: boolean,
    pendingChanges: Record<string, any>,
    shiftsMap: Record<string, any>,
    cellTurnosMap?: Record<string, any[]>,
): { s: any | null; p: any | null } {
    const key = `${empId}_${dateStr}`;
    const rawP = pendingChanges[key];
    const rawS = shiftsMap[key];
    const grupoIds = selectedGrupo && grupoUnifiedMode ? selectedGrupo.objectiveIds : null;

    if (rawP?.isDeleted) {
        const crossAfterDelete = pickCrossObjectiveSavedShift(rawS, selectedObjective);
        return { s: crossAfterDelete ?? rawS ?? null, p: rawP };
    }

    if (selectedGrupo && grupoUnifiedMode) {
        const active = rawP && !rawP.isDeleted ? rawP : rawS;
        if (!active) {
            const opsEmpty = pickOpsCoverageFromCellTurnos(cellTurnosMap?.[key], selectedObjective, grupoIds);
            return { s: opsEmpty ?? rawS ?? null, p: rawP && !rawP.isDeleted ? rawP : null };
        }
        const objId = active.objectiveId != null && active.objectiveId !== ''
            ? String(active.objectiveId)
            : null;
        if (rawP && !rawP.isDeleted) {
            if (objId && !selectedGrupo.objectiveIds.includes(objId)) {
                return { s: null, p: null };
            }
            return { s: rawS ?? null, p: rawP };
        }
        if (objId && selectedGrupo.objectiveIds.includes(objId)) {
            if (!isPlanningGridOperationalShift(active) || isOpsCoverageShift(active)) {
                return { s: rawS, p: null };
            }
        }
        const opsGrupo = pickOpsCoverageFromCellTurnos(cellTurnosMap?.[key], selectedObjective, grupoIds);
        if (opsGrupo) return { s: opsGrupo, p: null };
        return { s: null, p: null };
    }

    const resolved = resolveCellShiftAtObjective(empId, dateStr, selectedObjective, pendingChanges, shiftsMap);
    if (resolved) {
        if (rawP && !rawP.isDeleted) {
            return { s: rawS ?? null, p: rawP };
        }
        return { s: resolved, p: null };
    }

    const opsCov = pickOpsCoverageFromCellTurnos(cellTurnosMap?.[key], selectedObjective, null);
    if (opsCov) return { s: opsCov, p: null };

    const crossSaved = pickCrossObjectiveSavedShift(rawS, selectedObjective);
    if (crossSaved) {
        return { s: crossSaved, p: null };
    }

    if (rawP && !rawP.isDeleted) {
        const pObj = rawP.objectiveId;
        if (
            pObj != null && pObj !== '' && String(pObj) !== String(selectedObjective) &&
            !isPlanningGridOperationalShift(rawP)
        ) {
            return { s: rawP, p: null };
        }
    }

    return { s: null, p: null };
}
