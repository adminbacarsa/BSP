import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { belongsToEmpresaView } from '@/lib/multiempresa';

/** Prioridad al colisionar empId+día: cobertura Ops gana sobre franco/ausencia/plan vacío. */
export function planningShiftIngestPriority(shift: {
    origin?: unknown;
    resolvedBy?: unknown;
    isFrancoTrabajado?: unknown;
    coverageEventId?: unknown;
    coversAbsenceEmployeeName?: unknown;
    absenceShiftId?: unknown;
    coveredShiftId?: unknown;
    isExtended?: unknown;
    isEarlyStart?: unknown;
    coverageStatus?: unknown;
    coversBandCode?: unknown;
    code?: unknown;
    isAbsent?: unknown;
    isFranco?: unknown;
} | null | undefined): number {
    if (!shift) return 0;
    const o = String(shift.origin || '').toUpperCase();
    const code = String(shift.code || '').toUpperCase();
    const resolved = String(shift.resolvedBy || '').toUpperCase();
    let score = 1;
    if (o === 'OPERATIONS_COVERAGE') score += 50;
    if (resolved === 'OPERACIONES' || resolved === 'MODO_DEMO' || resolved === 'AUTO') score += 10;
    if (shift.isFrancoTrabajado) score += 40;
    if (shift.coverageEventId || shift.coversAbsenceEmployeeName || shift.absenceShiftId || shift.coveredShiftId) score += 20;
    if (shift.isExtended || shift.isEarlyStart) score += 15;
    if (String(shift.coverageStatus || '').toUpperCase() === 'COVERED' || shift.coversBandCode) score += 10;
    if (shift.isAbsent || code === 'AA' || code === 'V' || code === 'L' || code === 'E' || code === 'A') score -= 5;
    if (shift.isFranco || code === 'F' || code === 'FF' || code === 'FP') score -= 10;
    if (!code) score -= 20;
    return score;
}

function normalizePlanningShiftDoc(d: QueryDocumentSnapshot): any {
    const data = d.data();
    return {
        id: d.id,
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
        coversAbsenceEmployeeName: data.coversAbsenceEmployeeName || data.absenceEmployeeName,
        coveredByEmployeeName: data.coveredByEmployeeName,
        absenceShiftId: data.absenceShiftId,
        causedByShiftId: data.causedByShiftId,
        coverageEventId: data.coverageEventId || null,
        operacionallyCovered: !!data.operacionallyCovered,
        origin: data.origin,
        isFrancoTrabajado: data.isFrancoTrabajado || false,
        isFrancoCompensatorio: data.isFrancoCompensatorio || false,
        swapWith: data.swapWith,
        swapDate: data.swapDate,
        hasNovedad: data.hasNovedad,
        plannedNovedad: data.plannedNovedad,
        positionName: data.positionName,
        coveredBy: data.coveredBy || data.coveredByEmployeeName,
        coveredByEmployeeName: data.coveredByEmployeeName,
        francoObjectiveId: data.francoObjectiveId,
        coverageRedirectedTo: data.coverageRedirectedTo,
        isRelief: data.isRelief,
        coveragePackageId: data.coveragePackageId,
        coverageSegmentRole: data.coverageSegmentRole,
        coversPositionName: data.coversPositionName,
        coversEmployeeId: data.coversEmployeeId,
        coversBandCode: data.coversBandCode,
        coverageStatus: data.coverageStatus,
        coverageMode: data.coverageMode,
        coverageType: data.coverageType,
        coverageNote: data.coverageNote,
        deploymentRole: data.deploymentRole,
        deploymentBand: data.deploymentBand,
        surplusIntent: data.surplusIntent,
        countsForCoverage: data.countsForCoverage,
        isRefuerzo: data.isRefuerzo,
        isEscuela: data.isEscuela,
        isSecondBlock: data.isSecondBlock,
        scheduleDate: data.scheduleDate,
        planningDate: data.planningDate,
        extExtraHours: data.extExtraHours,
        extensionExtraHours: data.extensionExtraHours,
        /** Marca de auditoría Demo (presencia/ausencia simulada); no filtra la malla. */
        modoDemoAt: data.modoDemoAt || null,
        resolvedBy: data.resolvedBy || null,
        coveredShiftId: data.coveredShiftId || null,
    };
}

/** Cobertura Ops que el query mes a veces no trae; no descartar al re-aplicar snapshot. */
export function isRetainedOpsCoverageShift(shift: {
    origin?: unknown;
    resolvedBy?: unknown;
    isFrancoTrabajado?: unknown;
    coverageEventId?: unknown;
    coversAbsenceEmployeeName?: unknown;
    absenceShiftId?: unknown;
    coveredShiftId?: unknown;
    isExtended?: unknown;
    isEarlyStart?: unknown;
    coverageStatus?: unknown;
    coversBandCode?: unknown;
} | null | undefined): boolean {
    if (!shift) return false;
    const o = String(shift.origin || '').toUpperCase();
    if (o === 'OPERATIONS_COVERAGE') return true;
    if (shift.isFrancoTrabajado) return true;
    if (shift.coverageEventId || shift.coversAbsenceEmployeeName || shift.absenceShiftId || shift.coveredShiftId) return true;
    if (shift.isExtended || shift.isEarlyStart) return true;
    if (String(shift.coverageStatus || '').toUpperCase() === 'COVERED' && !!shift.coversBandCode) return true;
    const resolved = String(shift.resolvedBy || '').toUpperCase();
    if (resolved === 'MODO_DEMO' || resolved === 'OPERACIONES' || resolved === 'AUTO') {
        return o === 'OPERATIONS_COVERAGE' || o === 'RETEN' || o === 'INTERCAMBIO';
    }
    return false;
}

export type PlanningTurnosIngestResult = {
    shiftsMap: Record<string, any>;
    /** Todos los docs de turno por empId_fecha (incl. segundo bloque / ext en doc aparte). */
    cellTurnosMap: Record<string, any[]>;
    allShiftIds: Record<string, string[]>;
    turaMap: Record<string, any>;
    secondBlockMap: Record<string, { startTime: any; endTime: any }>;
    rfzVacantes: any[];
    rfzTodos: any[];
};

/** Convierte snapshot de turnos (mes) al estado de grilla de planificación. */
export function ingestPlanningTurnosSnapshot(
    docs: QueryDocumentSnapshot[],
    empresaId: string,
    migracionCompleta: boolean,
    getDateKey: (dateInput: any) => string,
    opts?: { rfzOnly?: boolean; turaOnly?: boolean },
): PlanningTurnosIngestResult {
    const map: Record<string, any> = {};
    const cellTurnos: Record<string, any[]> = {};
    const allIds: Record<string, string[]> = {};
    const turaM: Record<string, any> = {};
    const secondBlocksMap: Record<string, { startTime: any; endTime: any }> = {};
    const rfzVacs: any[] = [];
    const rfzAll: any[] = [];
    const rfzOnly = opts?.rfzOnly === true;

    docs.forEach((d) => {
        const data = d.data();
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        if (data.isDeleted === true) return;
        const code = (data.code || data.type || '').toString().toUpperCase();

        if (code === 'RFZ') {
            const rfzData = { id: d.id, ...data };
            rfzAll.push(rfzData);
            if (!data.employeeId || data.employeeId === 'VACANTE') rfzVacs.push(rfzData);
            return;
        }

        if (rfzOnly) return;

        if (code === 'TURA') {
            const turaData = { id: d.id, ...data };
            if (data.parentShiftId) {
                turaM[data.parentShiftId] = turaData;
            } else {
                turaM[`__tura_${d.id}`] = turaData;
            }
            if (opts?.turaOnly) return;
            return;
        }

        if (opts?.turaOnly) return;

        const rawStart = data.startTime || data.scheduleDate || data.planningDate || data.fecha;
        const hasStart = rawStart && (rawStart.seconds || typeof rawStart === 'string' || rawStart instanceof Date);
        if (hasStart && data.employeeId) {
            const dateKey = getDateKey(rawStart);
            const key = `${data.employeeId}_${dateKey}`;
            if (!allIds[key]) allIds[key] = [];
            allIds[key].push(d.id);
            const normalized = normalizePlanningShiftDoc(d);
            if (!cellTurnos[key]) cellTurnos[key] = [];
            cellTurnos[key].push(normalized);
            if (data.isSecondBlock) {
                secondBlocksMap[key] = { startTime: data.startTime, endTime: data.endTime };
                return;
            }
            const prev = map[key];
            if (!prev || planningShiftIngestPriority(normalized) >= planningShiftIngestPriority(prev)) {
                map[key] = normalized;
            }
        }
    });

    return {
        shiftsMap: map,
        cellTurnosMap: cellTurnos,
        allShiftIds: allIds,
        turaMap: turaM,
        secondBlockMap: secondBlocksMap,
        rfzVacantes: rfzVacs,
        rfzTodos: rfzAll,
    };
}
