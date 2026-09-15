import {
    collection,
    getDocs,
    query,
    where,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
    belongsToEmpresaView,
    fetchMergedPlanificacionEstadoData,
    fetchPlanificacionEstadoDoc,
    planificacionPublishLookupKey,
} from '@/lib/multiempresa';
import { buildDotacionMapsFromEmployees } from '@/lib/planificacion/planificacionDotacionUtils';
import { buildPlanningMonthTurnosQuery } from '@/lib/planificacion/loadPlanningMonthShifts';
import { getDateKey } from '@/lib/planificacion/utils';
import {
    isRetainedOpsCoverageShift,
    planningShiftIngestPriority,
} from '@/lib/planificacion/planningTurnosIngest';

export type RefreshPlanificacionCronogramaParams = {
    empresaId: string | null | undefined;
    migracionCompleta: boolean;
    scopeEmpresa?: boolean;
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
    /** Entradas del objetivo/mes (fuente objectiveId; incluye coberturas Ops). */
    monthEntries: Array<{ key: string; value: Record<string, any> }>;
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
            coveredBy: data.coveredBy || data.coveredByEmployeeName,
            francoObjectiveId: data.francoObjectiveId,
            coverageRedirectedTo: data.coverageRedirectedTo,
            coveragePackageId: data.coveragePackageId,
            coverageSegmentRole: data.coverageSegmentRole,
            coversPositionName: data.coversPositionName,
            coversEmployeeId: data.coversEmployeeId,
            coversBandCode: data.coversBandCode,
            coverageStatus: data.coverageStatus,
            coverageMode: data.coverageMode,
            coverageType: data.coverageType,
            coverageNote: data.coverageNote,
            countsForCoverage: data.countsForCoverage,
            extExtraHours: data.extExtraHours,
            extensionExtraHours: data.extensionExtraHours,
            modoDemoAt: data.modoDemoAt || null,
            resolvedBy: data.resolvedBy || null,
            coveredShiftId: data.coveredShiftId || null,
            draft: data.draft,
        },
    };
}

function shiftMatchesSelectedObjective(data: Record<string, any>, selectedObjective: string): boolean {
    const target = String(selectedObjective);
    if (data.objectiveId && String(data.objectiveId) === target) return true;
    if (data.francoObjectiveId && String(data.francoObjectiveId) === target) return true;
    if (data.coverageRedirectedTo && String(data.coverageRedirectedTo) === target) return true;
    return false;
}

export async function loadPlanificacionCronogramaRefresh({
    empresaId,
    migracionCompleta,
    scopeEmpresa = true,
    selectedObjective,
    year,
    month,
    employees,
}: RefreshPlanificacionCronogramaParams): Promise<RefreshPlanificacionCronogramaResult> {
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const lookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
    const empId = String(empresaId ?? '').trim();

    const [estadoRow, turnosSnap, monthSnap, mergedEstado] = await Promise.all([
        fetchPlanificacionEstadoDoc(empresaId, selectedObjective, year, month),
        getDocs(query(
            collection(db, 'turnos'),
            where('objectiveId', '==', selectedObjective),
        )),
        empId
            ? getDocs(buildPlanningMonthTurnosQuery({
                empresaId: empId,
                scopeEmpresa,
                year,
                month,
            }))
            : Promise.resolve({ docs: [] as QueryDocumentSnapshot[] }),
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

    const byKey = new Map<string, { key: string; value: Record<string, any> }>();
    const ingestDoc = (d: QueryDocumentSnapshot) => {
        const data = d.data();
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        if (data.isDeleted === true) return;
        const code = String(data.code || data.type || '').toUpperCase();
        if (code === 'RFZ' || code === 'TURA') return;
        const rawStart = data.startTime || data.scheduleDate || data.planningDate || data.fecha;
        const hasStart = rawStart && (rawStart.seconds || typeof rawStart === 'string' || rawStart instanceof Date);
        if (!hasStart || !data.employeeId) return;
        const dateKey = getDateKey(rawStart);
        if (!dateKey.startsWith(monthPrefix)) return;
        if (!shiftMatchesSelectedObjective(data, selectedObjective)) return;
        const entry = turnoDocToShiftMapEntry(d.id, data, dateKey);
        const prev = byKey.get(entry.key);
        if (!prev || planningShiftIngestPriority(entry.value) >= planningShiftIngestPriority(prev.value)) {
            byKey.set(entry.key, entry);
        }
    };
    // Unión: por objectiveId (cubre Ops sin caer en el query mes) + malla mes (FT/francoObjectiveId).
    turnosSnap.docs.forEach(ingestDoc);
    monthSnap.docs.forEach(ingestDoc);
    const monthEntries = Array.from(byKey.values());

    const mergeShiftsMap = (prev: Record<string, any>) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
            const s = next[key];
            if (!s) continue;
            if (!shiftMatchesSelectedObjective(s, selectedObjective)) continue;
            const dateKey = key.includes('_') ? key.slice(key.indexOf('_') + 1) : '';
            if (dateKey.startsWith(monthPrefix)) delete next[key];
        }
        for (const { key, value } of monthEntries) {
            next[key] = value;
        }
        // Conservar coberturas Ops de otras queries (p.ej. FT con francoObjectiveId ya mergeado).
        for (const [key, s] of Object.entries(prev)) {
            if (next[key] || !s) continue;
            if (!isRetainedOpsCoverageShift(s)) continue;
            if (!shiftMatchesSelectedObjective(s, selectedObjective)) continue;
            const dateKey = key.includes('_') ? key.slice(key.indexOf('_') + 1) : '';
            if (!dateKey.startsWith(monthPrefix)) continue;
            next[key] = s;
        }
        return next;
    };

    return {
        lookupKey,
        publishStatusEntry,
        empDefaultPos: mergedPos,
        empDefaultShift: mergedShift,
        monthEntries,
        mergeShiftsMap,
    };
}
