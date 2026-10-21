import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { belongsToEmpresaView } from '@/lib/multiempresa';
import { elegirVistaCelda } from '@/lib/planificacion/bandaLicencia';
import { medirSeccion } from '@/lib/planificacion/perfGrilla';

/** Docs por tanda: parte el hilo para que un mes grande no sea una sola traba. */
const TANDA_TURNOS = 400;

export function planningShiftViewFromSnap(d: QueryDocumentSnapshot): any {
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
        isExtended: data.isExtended,
        isEarlyStart: data.isEarlyStart === true || data.isEarlyEntry === true || data.isAdvanced === true,
        isFrancoTrabajado: data.isFrancoTrabajado || false,
        isFrancoCompensatorio: data.isFrancoCompensatorio || false,
        swapWith: data.swapWith,
        swapDate: data.swapDate,
        hasNovedad: data.hasNovedad,
        plannedNovedad: data.plannedNovedad,
        positionName: data.positionName,
        coveredBy: data.coveredBy || data.coveredByEmployeeName || undefined,
        coveragePackageId: data.coveragePackageId,
        coverageSegmentRole: data.coverageSegmentRole,
        coversPositionName: data.coversPositionName,
        coversEmployeeId: data.coversEmployeeId,
        coversEmployeeName: data.coversEmployeeName,
        absenceShiftId: data.absenceShiftId || data.coveredShiftId,
        coveredShiftId: data.coveredShiftId || data.absenceShiftId,
        coverageSuperseded: data.coverageSuperseded === true,
        coversBandCode: data.coversBandCode,
        coversDateStr: data.coversDateStr,
        segmentFromTime: data.segmentFromTime,
        segmentToTime: data.segmentToTime,
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
    };
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

function vacioIngest(): PlanningTurnosIngestResult {
    return {
        shiftsMap: {},
        cellTurnosMap: {},
        allShiftIds: {},
        turaMap: {},
        secondBlockMap: {},
        rfzVacantes: [],
        rfzTodos: [],
    };
}

function acumularDocs(
    docs: QueryDocumentSnapshot[],
    empresaId: string,
    migracionCompleta: boolean,
    getDateKey: (dateInput: any) => string,
    opts: { rfzOnly?: boolean; turaOnly?: boolean } | undefined,
    into: PlanningTurnosIngestResult,
): void {
    const rfzOnly = opts?.rfzOnly === true;
    const map = into.shiftsMap;
    const cellTurnos = into.cellTurnosMap;
    const allIds = into.allShiftIds;
    const turaM = into.turaMap;
    const secondBlocksMap = into.secondBlockMap;
    docs.forEach((d) => {
        const data = d.data();
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        if (data.isDeleted === true) return;
        const code = (data.code || data.type || '').toString().toUpperCase();

        if (code === 'RFZ') {
            const rfzData = { id: d.id, ...data };
            into.rfzTodos.push(rfzData);
            if (!data.employeeId || data.employeeId === 'VACANTE') into.rfzVacantes.push(rfzData);
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

        if (data.startTime?.seconds) {
            const dateKey = getDateKey(data.startTime);
            const key = `${data.employeeId}_${dateKey}`;
            if (!allIds[key]) allIds[key] = [];
            allIds[key].push(d.id);
            const normalized = planningShiftViewFromSnap(d);
            if (!cellTurnos[key]) cellTurnos[key] = [];
            cellTurnos[key].push(normalized);
            if (data.isSecondBlock) {
                secondBlocksMap[key] = { startTime: data.startTime, endTime: data.endTime };
                return;
            }
            map[key] = normalized;
        }
    });
}

function cerrarVistas(into: PlanningTurnosIngestResult): void {
    for (const [key, lista] of Object.entries(into.cellTurnosMap)) {
        const vista = elegirVistaCelda(lista);
        if (vista) into.shiftsMap[key] = vista;
    }
}

/** Convierte snapshot de turnos (mes) al estado de grilla de planificación. */
export function ingestPlanningTurnosSnapshot(
    docs: QueryDocumentSnapshot[],
    empresaId: string,
    migracionCompleta: boolean,
    getDateKey: (dateInput: any) => string,
    opts?: { rfzOnly?: boolean; turaOnly?: boolean },
): PlanningTurnosIngestResult {
    const into = vacioIngest();
    acumularDocs(docs, empresaId, migracionCompleta, getDateKey, opts, into);
    cerrarVistas(into);
    return into;
}

function cederHilo(): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, 0); });
}

/**
 * Misma salida que ingestPlanningTurnosSnapshot, cediendo el hilo entre tandas.
 * Un mes de toda la empresa deja de ser una sola traba de varios segundos.
 */
export async function ingestPlanningTurnosPorTandas(
    docs: QueryDocumentSnapshot[],
    empresaId: string,
    migracionCompleta: boolean,
    getDateKey: (dateInput: any) => string,
    opts?: { rfzOnly?: boolean; turaOnly?: boolean },
): Promise<PlanningTurnosIngestResult> {
    if (docs.length <= TANDA_TURNOS) {
        return medirSeccion('ingest turnos mes', () => ingestPlanningTurnosSnapshot(docs, empresaId, migracionCompleta, getDateKey, opts));
    }
    const into = vacioIngest();
    for (let i = 0; i < docs.length; i += TANDA_TURNOS) {
        const corte = docs.slice(i, i + TANDA_TURNOS);
        medirSeccion('ingest turnos mes', () => {
            acumularDocs(corte, empresaId, migracionCompleta, getDateKey, opts, into);
        });
        if (i + TANDA_TURNOS < docs.length) await cederHilo();
    }
    medirSeccion('ingest turnos mes vista', () => cerrarVistas(into));
    return into;
}
