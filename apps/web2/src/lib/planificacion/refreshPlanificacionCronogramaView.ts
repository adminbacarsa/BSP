import {
    collection,
    getDocs,
    query,
    where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
    belongsToEmpresaView,
    fetchMergedPlanificacionEstadoData,
    fetchPlanificacionEstadoDoc,
    planificacionPublishLookupKey,
} from '@/lib/multiempresa';
import { buildDotacionMapsFromEmployees } from '@/lib/planificacion/planificacionDotacionUtils';
import { getDateKey } from '@/lib/planificacion/utils';

export type RefreshPlanificacionCronogramaParams = {
    empresaId: string | null | undefined;
    migracionCompleta: boolean;
    selectedObjective: string;
    year: number;
    month: number;
    employees: { id: string; planificacionDotacion?: Record<string, unknown> }[];
};

export type RefreshPlanificacionCronogramaResult = {
    lookupKey: string;
    publishStatusEntry: { publishedAt: unknown; publishedBy: string } | null;
    empDefaultPos: Record<string, string>;
    empDefaultShift: Record<string, string>;
    mergeShiftsMap: (prev: Record<string, any>) => Record<string, any>;
};

function turnoDocToShiftMapEntry(docId: string, data: Record<string, any>, dateKey: string) {
    const empKey = `${data.employeeId}_${dateKey}`;
    return {
        key: empKey,
        value: {
            id: docId,
            ...data,
            code: data.code || data.type,
            objectiveId: data.objectiveId,
            startTime: data.startTime,
            endTime: data.endTime,
            realStartTime: data.realStartTime,
            status: data.status,
            isPresent: data.isPresent || false,
            isAbsent: data.isAbsent || false,
            isExtended: data.isExtended || data.isRetention,
            isRetention: !!data.isRetention,
            isEarlyStart: data.isEarlyStart || data.isEarlyEntry,
            origin: data.origin,
            coversAbsenceEmployeeName: data.coversAbsenceEmployeeName || data.absenceEmployeeName,
            coveredByEmployeeName: data.coveredByEmployeeName,
            absenceShiftId: data.absenceShiftId,
            causedByShiftId: data.causedByShiftId,
            coverageEventId: data.coverageEventId || null,
            operacionallyCovered: !!data.operacionallyCovered,
            isFrancoTrabajado: data.isFrancoTrabajado || false,
            isFrancoCompensatorio: data.isFrancoCompensatorio || false,
            swapWith: data.swapWith,
            swapDate: data.swapDate,
            hasNovedad: data.hasNovedad,
            plannedNovedad: data.plannedNovedad,
            positionName: data.positionName,
            coveredBy: data.coveredBy,
            draft: data.draft,
        },
    };
}

export async function loadPlanificacionCronogramaRefresh({
    empresaId,
    migracionCompleta,
    selectedObjective,
    year,
    month,
    employees,
}: RefreshPlanificacionCronogramaParams): Promise<RefreshPlanificacionCronogramaResult> {
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const lookupKey = planificacionPublishLookupKey(selectedObjective, year, month);

    const [estadoRow, turnosSnap, mergedEstado] = await Promise.all([
        fetchPlanificacionEstadoDoc(empresaId, selectedObjective, year, month),
        getDocs(query(
            collection(db, 'turnos'),
            where('objectiveId', '==', selectedObjective),
        )),
        fetchMergedPlanificacionEstadoData(empresaId, selectedObjective, year, month),
    ]);

    const publishStatusEntry = estadoRow?.data.publishedAt
        ? {
            publishedAt: estadoRow.data.publishedAt,
            publishedBy: String(estadoRow.data.publishedBy ?? ''),
        }
        : null;

    const monthlyPos = (mergedEstado.defaultPositionByEmp as Record<string, string>) || {};
    const monthlyShift = (mergedEstado.defaultShiftByEmp as Record<string, string>) || {};
    const { pos: basePos, shift: baseShift } = buildDotacionMapsFromEmployees(employees);
    const mergedPos = { ...basePos };
    const mergedShift = { ...baseShift };
    for (const [id, p] of Object.entries(monthlyPos)) mergedPos[`${id}___${selectedObjective}`] = p;
    for (const [id, s] of Object.entries(monthlyShift)) mergedShift[`${id}___${selectedObjective}`] = s;

    const monthEntries: Array<{ key: string; value: Record<string, any> }> = [];
    turnosSnap.docs.forEach(d => {
        const data = d.data();
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        const code = String(data.code || data.type || '').toUpperCase();
        if (code === 'RFZ' || code === 'TURA') return;
        if (!data.startTime?.seconds) return;
        const dateKey = getDateKey(data.startTime);
        if (!dateKey.startsWith(monthPrefix)) return;
        monthEntries.push(turnoDocToShiftMapEntry(d.id, data, dateKey));
    });

    const mergeShiftsMap = (prev: Record<string, any>) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
            const s = next[key];
            if (!s) continue;
            if (String(s.objectiveId || '') !== String(selectedObjective)) continue;
            const dateKey = key.includes('_') ? key.slice(key.indexOf('_') + 1) : '';
            if (dateKey.startsWith(monthPrefix)) delete next[key];
        }
        for (const { key, value } of monthEntries) {
            next[key] = value;
        }
        return next;
    };

    return {
        lookupKey,
        publishStatusEntry,
        empDefaultPos: mergedPos,
        empDefaultShift: mergedShift,
        mergeShiftsMap,
    };
}
