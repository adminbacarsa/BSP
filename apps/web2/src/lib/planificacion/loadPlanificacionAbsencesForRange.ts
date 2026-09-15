import { getDocs } from 'firebase/firestore';
import { getDateKey } from '@/lib/planificacion/utils';
import {
    inferAbsenceCode,
    isActiveAbsence,
    iterateCalendarDateRange,
    toCalendarDateStr,
    validateAbsenceDateRange,
} from '@/lib/planificacion/absenceCodes';
import { belongsToEmpresaView, empresaCollectionQuery } from '@/lib/multiempresa';

export const PLANIFICACION_RRHH_ABSENCE_GRID = new Set(['V', 'L', 'A', 'E', 'AA', 'PG']);

export type PlanificacionAbsencesByEmp = Record<string, Map<string, string>>;

export type LoadPlanificacionAbsencesForRangeParams = {
    monthStart: Date;
    monthEnd: Date;
    empresaId: string;
    scopeEmpresa: boolean;
    migracionCompleta: boolean;
};

/**
 * Carga las ausencias que SOLAPAN con el rango [monthStart, monthEnd], no solo
 * las que ARRANCAN dentro del mes. Esto soluciona el caso de vacaciones / ART
 * que empezaron antes y siguen vigentes en el mes a planificar.
 */
export async function loadPlanificacionAbsencesForRange({
    monthStart,
    monthEnd,
    empresaId,
    scopeEmpresa,
    migracionCompleta,
}: LoadPlanificacionAbsencesForRangeParams): Promise<PlanificacionAbsencesByEmp> {
    const absSnap = await getDocs(empresaCollectionQuery('ausencias', empresaId, scopeEmpresa));
    const monthStartStr = toCalendarDateStr(monthStart) || getDateKey(monthStart);
    const monthEndStr = toCalendarDateStr(monthEnd) || getDateKey(monthEnd);
    const absences: PlanificacionAbsencesByEmp = {};
    absSnap.docs.forEach(d => {
        const data = d.data() as any;
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        const empId = data.employeeId;
        if (!empId) return;
        if (!isActiveAbsence(data)) return;
        const startStr = toCalendarDateStr(data.startDate);
        const endStr = toCalendarDateStr(data.endDate);
        if (!startStr || !endStr) return;
        const range = validateAbsenceDateRange(startStr, endStr);
        if (!range.ok) return;
        if (range.endDate < monthStartStr || range.startDate > monthEndStr) return;
        const code = inferAbsenceCode(data);
        if (!absences[empId]) absences[empId] = new Map();
        iterateCalendarDateRange(range.startDate, range.endDate).forEach((dateStr) => {
            if (dateStr < monthStartStr || dateStr > monthEndStr) return;
            const [y, m, day] = dateStr.split('-').map(Number);
            absences[empId].set(getDateKey(new Date(y, m - 1, day, 12, 0, 0, 0)), code);
        });
    });
    return absences;
}

export type MergePlanificacionAbsencesFromLocalGridParams = {
    absences: PlanificacionAbsencesByEmp;
    empIds: string[];
    monthStart: Date;
    monthEnd: Date;
    selectedObjective: string;
    shiftsMap: Record<string, any>;
    pendingChanges: Record<string, any>;
};

/** Licencias/ausencias ya visibles en grilla o pendientes (no solo colección ausencias). */
export function mergePlanificacionAbsencesFromLocalGrid({
    absences,
    empIds,
    monthStart,
    monthEnd,
    selectedObjective,
    shiftsMap,
    pendingChanges,
}: MergePlanificacionAbsencesFromLocalGridParams): void {
    const idSet = new Set(empIds);
    const mergeCell = (empId: string, dateStr: string, code: string) => {
        if (!idSet.has(empId)) return;
        const d = new Date(`${dateStr}T12:00:00`);
        if (d < monthStart || d > monthEnd) return;
        if (!absences[empId]) absences[empId] = new Map();
        if (!absences[empId].has(dateStr)) absences[empId].set(dateStr, code);
    };
    const scan = (src: Record<string, any>) => {
        Object.entries(src).forEach(([key, cell]) => {
            if (!cell || cell.isDeleted) return;
            if (cell.objectiveId && cell.objectiveId !== selectedObjective) return;
            const code = String(cell.code || '').toUpperCase();
            if (!PLANIFICACION_RRHH_ABSENCE_GRID.has(code)) return;
            const empId = String(cell.employeeId || key.split('_')[0] || '');
            const dateStr = String(cell.dateStr || key.slice(empId.length + 1) || '');
            if (!empId || !dateStr) return;
            mergeCell(empId, dateStr, code);
        });
    };
    scan(shiftsMap);
    scan(pendingChanges);
}
