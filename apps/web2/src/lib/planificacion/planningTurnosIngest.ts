import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { belongsToEmpresaView } from '@/lib/multiempresa';

export type PlanningTurnosIngestResult = {
    shiftsMap: Record<string, any>;
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
    opts?: { rfzOnly?: boolean },
): PlanningTurnosIngestResult {
    const map: Record<string, any> = {};
    const allIds: Record<string, string[]> = {};
    const turaM: Record<string, any> = {};
    const secondBlocksMap: Record<string, { startTime: any; endTime: any }> = {};
    const rfzVacs: any[] = [];
    const rfzAll: any[] = [];
    const rfzOnly = opts?.rfzOnly === true;

    docs.forEach((d) => {
        const data = d.data();
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        const code = (data.code || data.type || '').toString().toUpperCase();

        if (code === 'RFZ') {
            const rfzData = { id: d.id, ...data };
            rfzAll.push(rfzData);
            if (!data.employeeId || data.employeeId === 'VACANTE') rfzVacs.push(rfzData);
            return;
        }

        if (rfzOnly) return;

        if (code === 'TURA' && data.parentShiftId) {
            turaM[data.parentShiftId] = { id: d.id, ...data };
            return;
        }

        if (data.startTime?.seconds) {
            const dateKey = getDateKey(data.startTime);
            const key = `${data.employeeId}_${dateKey}`;
            if (!allIds[key]) allIds[key] = [];
            allIds[key].push(d.id);
            if (data.isSecondBlock) {
                secondBlocksMap[key] = { startTime: data.startTime, endTime: data.endTime };
                return;
            }
            map[key] = {
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
                isExtended: data.isExtended,
                isEarlyStart: data.isEarlyStart || data.isEarlyEntry,
                isFrancoTrabajado: data.isFrancoTrabajado || false,
                isFrancoCompensatorio: data.isFrancoCompensatorio || false,
                swapWith: data.swapWith,
                swapDate: data.swapDate,
                hasNovedad: data.hasNovedad,
                plannedNovedad: data.plannedNovedad,
                positionName: data.positionName,
                coveredBy: data.coveredBy,
                coveragePackageId: data.coveragePackageId,
                coverageSegmentRole: data.coverageSegmentRole,
                coversPositionName: data.coversPositionName,
                coversEmployeeId: data.coversEmployeeId,
                coversBandCode: data.coversBandCode,
                coverageStatus: data.coverageStatus,
                coverageNote: data.coverageNote,
                deploymentRole: data.deploymentRole,
                deploymentBand: data.deploymentBand,
                surplusIntent: data.surplusIntent,
                countsForCoverage: data.countsForCoverage,
                isRefuerzo: data.isRefuerzo,
                isEscuela: data.isEscuela,
            };
        }
    });

    return {
        shiftsMap: map,
        allShiftIds: allIds,
        turaMap: turaM,
        secondBlockMap: secondBlocksMap,
        rfzVacantes: rfzVacs,
        rfzTodos: rfzAll,
    };
}
