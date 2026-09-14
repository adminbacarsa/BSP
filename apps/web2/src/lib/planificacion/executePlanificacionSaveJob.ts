import { getAuth } from 'firebase/auth';
import {
    addDoc,
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    Timestamp,
    updateDoc,
    where,
    writeBatch,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { rebuildHoursBalanceForObjectiveMonth } from '@/lib/hoursBalance';
import {
    planificacionPublishLookupKey,
    stampEmpresaId,
} from '@/lib/multiempresa';
import { deploymentFieldsForFirestore } from '@/lib/planificacion/deploymentRoles';
import { patchExperienciaForTurno } from '@/lib/planificacion/experienciaObjetivos';
import { SHIFT_HOURS_LOOKUP } from '@/lib/planificacion/planificacionGridVisuals';
import { isPlanificacionPublished } from '@/lib/planificacion/planificacionPlanningShiftRules';
import { touchPlanificacionEstadoActivity } from '@/lib/planificacion/planningCronogramaOverview';
import type { PendingAbsenceNovedad, RecompositionPackage } from '@/lib/planificacion/planningRecomposition.types';
import { extractPackagesFromPending, emitRecompositionNotifications } from '@/lib/planificacion/planningRecompositionNotify';
import { planToastSaveError, planToastSaved } from '@/lib/planificacion/planToast';
import type { Dispatch, SetStateAction } from 'react';

function getSafeTime(input: unknown): [number, number] {
    if (!input) return [6, 0];
    if (typeof input === 'string') return input.split(':').map(Number) as [number, number];
    const anyInput = input as { toDate?: () => Date; seconds?: number };
    if (anyInput.toDate) {
        const d = anyInput.toDate();
        return [d.getHours(), d.getMinutes()];
    }
    if (anyInput.seconds) {
        const d = new Date(anyInput.seconds * 1000);
        return [d.getHours(), d.getMinutes()];
    }
    if (input instanceof Date) return [input.getHours(), input.getMinutes()];
    return [6, 0];
}

export type ExecutePlanificacionSaveJobParams = {
    jobPending: Record<string, any>;
    jobShiftsMap: Record<string, any>;
    jobAllShiftIds: Record<string, string[]>;
    jobNovedades: Record<string, PendingAbsenceNovedad>;
    jobPackages: RecompositionPackage[];
    jobCount: number;
    snapshotData: unknown;
    empresaId: string | null | undefined;
    selectedObjective: string;
    selectedClient: string;
    currentDate: Date;
    employees: any[];
    positionStructure: any[];
    correctionMode: boolean;
    publishStatusMap: Record<string, { publishedAt: unknown; publishedBy: string } | null>;
    activeActorName: string;
    scopeEmpresa: boolean;
    resolveObjectiveForEmp: (empId: string) => string;
    getObjectiveName: (objectiveId: string) => string;
    setPendingChanges: Dispatch<SetStateAction<Record<string, any>>>;
    setPendingNovedades: Dispatch<SetStateAction<Record<string, PendingAbsenceNovedad>>>;
    setPendingRecompositionPackages: Dispatch<SetStateAction<RecompositionPackage[]>>;
    setNeedsRepublishMap: Dispatch<SetStateAction<Record<string, boolean>>>;
    setBackgroundSaveCount: Dispatch<SetStateAction<number>>;
};

export async function executePlanificacionSaveJob({
    jobPending,
    jobShiftsMap,
    jobAllShiftIds,
    jobNovedades,
    jobPackages,
    jobCount,
    snapshotData,
    empresaId,
    selectedObjective,
    selectedClient,
    currentDate,
    employees,
    positionStructure,
    correctionMode,
    publishStatusMap,
    activeActorName,
    scopeEmpresa,
    resolveObjectiveForEmp,
    getObjectiveName,
    setPendingChanges,
    setPendingNovedades,
    setPendingRecompositionPackages,
    setNeedsRepublishMap,
    setBackgroundSaveCount,
}: ExecutePlanificacionSaveJobParams): Promise<void> {
    let batch = writeBatch(db);
    let batchOps = 0;
    const BATCH_LIMIT = 450;
    const AUDIT_CONSOLIDATE_MIN = 3;
    const bumpBatchOp = () => { batchOps++; };
    const flushBatchWhenFull = async () => {
        if (batchOps < BATCH_LIMIT) return;
        await batch.commit();
        batch = writeBatch(db);
        batchOps = 0;
    };
    const flushBatch = async () => {
        if (batchOps === 0) return;
        await batch.commit();
        batch = writeBatch(db);
        batchOps = 0;
    };
    const auth = getAuth();
    const realActorName = activeActorName || 'Sistema';
    const pubYear = currentDate.getFullYear();
    const pubMonth = currentDate.getMonth() + 1;
    const publishLookupKey = planificacionPublishLookupKey(selectedObjective, pubYear, pubMonth);
    const isPublished = isPlanificacionPublished(publishStatusMap[publishLookupKey]);
    const logData: { empId: string; date: string; action: string; detail: string }[] = [];
    const employeesById: Record<string, any> = {};
    employees.forEach((e: any) => { employeesById[e.id] = e; });
    const savedPendingChanges = jobPending;
    const savedPendingNovedades = jobNovedades;
    const savedRecompositionPackages = jobPackages;
    const slaShiftByPosCode = new Map<string, any>();
    for (const pos of positionStructure) {
        for (const sh of ((pos.shifts || []) as any[])) {
            const ck = `${pos.positionName}__${String(sh.code || '').toUpperCase()}`;
            if (!slaShiftByPosCode.has(ck)) slaShiftByPosCode.set(ck, sh);
        }
    }

    const restorePendingOnFailure = () => {
        setPendingChanges((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(jobPending)) {
                if (!(k in next)) next[k] = v;
            }
            return next;
        });
        if (Object.keys(jobNovedades).length > 0) {
            setPendingNovedades((prev) => ({ ...jobNovedades, ...prev }));
        }
        if (jobPackages.length > 0) {
            setPendingRecompositionPackages((prev) => [...jobPackages, ...prev]);
        }
    };

    const eventoSolicitudCache = new Map<string, Array<{ id: string; tipo?: string; status?: string }>>();

    const readEventoSolicitudes = async (
        eventoId: string,
        servicioId: string,
        empleadoId: string,
    ) => {
        const cacheKey = `${eventoId}__${servicioId}__${empleadoId}`;
        if (eventoSolicitudCache.has(cacheKey)) return eventoSolicitudCache.get(cacheKey)!;
        const snap = await getDocs(query(
            collection(db, 'solicitudes_evento'),
            where('empresaId', '==', empresaId),
            where('eventoId', '==', eventoId),
            where('servicioId', '==', servicioId),
            where('empleadoId', '==', empleadoId),
        ));
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        eventoSolicitudCache.set(cacheKey, rows);
        return rows;
    };

    const rollbackEventoSolicitud = async (
        eventoId: string,
        servicioId: string,
        empleadoId: string,
    ) => {
        if (!eventoId || !servicioId || !empleadoId) return;
        const rows = await readEventoSolicitudes(eventoId, servicioId, empleadoId);
        if (rows.length === 0) return;
        for (const row of rows) {
            if (row.tipo === 'admin_asigna') {
                batch.delete(doc(db, 'solicitudes_evento', row.id));
            } else {
                batch.update(doc(db, 'solicitudes_evento', row.id), {
                    status: 'convocado',
                    respondidoAt: serverTimestamp(),
                    respondidoPor: auth.currentUser?.uid || '',
                });
            }
            bumpBatchOp();
            await flushBatchWhenFull();
        }
        eventoSolicitudCache.delete(`${eventoId}__${servicioId}__${empleadoId}`);
    };

    const approveEventoSolicitud = async (
        change: any,
        empId: string,
        empName: string,
        dateStr: string,
    ) => {
        const eventoId = String(change?.eventoId || '');
        const servicioId = String(change?.servicioId || '');
        if (!eventoId || !servicioId) return;
        const rows = await readEventoSolicitudes(eventoId, servicioId, empId);
        if (rows.length > 0) {
            const first = rows[0];
            batch.update(doc(db, 'solicitudes_evento', first.id), {
                status: 'aprobada',
                tipo: first.tipo || 'admin_asigna',
                eventoNombre: change.eventoNombre || null,
                servicioNombre: change.servicioNombre || null,
                servicioFecha: dateStr,
                respondidoAt: serverTimestamp(),
                respondidoPor: auth.currentUser?.uid || '',
            });
            bumpBatchOp();
            await flushBatchWhenFull();
            return;
        }
        const newRef = doc(collection(db, 'solicitudes_evento'));
        batch.set(newRef, stampEmpresaId({
            empresaId,
            eventoId,
            eventoNombre: change.eventoNombre || '',
            servicioId,
            servicioNombre: change.servicioNombre || '',
            servicioFecha: dateStr,
            empleadoId: empId,
            empleadoNombre: empName,
            status: 'aprobada',
            tipo: 'admin_asigna',
            convocadoPor: auth.currentUser?.uid || '',
            respondidoPor: auth.currentUser?.uid || '',
            respondidoAt: serverTimestamp(),
            creadoAt: serverTimestamp(),
        }, empresaId));
        bumpBatchOp();
        await flushBatchWhenFull();
        eventoSolicitudCache.set(`${eventoId}__${servicioId}__${empId}`, [{
            id: newRef.id,
            tipo: 'admin_asigna',
            status: 'aprobada',
        }]);
    };

    const registerPlanificacionCorreccion = async (
        empId: string,
        empName: string,
        dateStr: string,
        actionDetail: string,
        codigoAntes: string,
        codigoDespues: string,
    ) => {
        if (!correctionMode) return;
        const [y, m, d] = dateStr.split('-').map(Number);
        const corrFechaTs = Timestamp.fromDate(new Date(y, m - 1, d, 12, 0, 0));
        const tipoCorr =
            codigoAntes && codigoDespues && codigoAntes !== codigoDespues && codigoDespues !== '(eliminado)'
                ? 'CORRECCION_CODIGO'
                : 'CORRECCION_PLANIFICACION';
        logData.push({ empId, date: dateStr, action: 'CORRECCION_SUPERADMIN', detail: '' });
        batch.set(doc(collection(db, 'audit_logs')), stampEmpresaId({
            action: 'CORRECCION_SUPERADMIN',
            module: 'PLANIFICADOR',
            details: `[CORRECCIÓN] ${actionDetail}`,
            timestamp: serverTimestamp(),
            actorName: realActorName,
            actorUid: auth.currentUser?.uid,
            employeeId: empId,
            employeeName: empName,
            fecha: corrFechaTs,
        }, empresaId));
        bumpBatchOp();
        await flushBatchWhenFull();
        batch.set(doc(collection(db, 'ajustes_horas')), stampEmpresaId({
            employeeId: empId,
            employeeName: empName,
            tipo: tipoCorr,
            fecha: corrFechaTs,
            motivo: actionDetail,
            codigoAntes,
            codigoDespues,
            objectiveId: selectedObjective,
            objectiveName: getObjectiveName(selectedObjective),
            origen: 'PLANIFICACION',
            creadoPor: auth.currentUser?.uid || '',
            creadoPorNombre: realActorName,
            creadoEn: serverTimestamp(),
        }, empresaId));
        bumpBatchOp();
        await flushBatchWhenFull();
    };

    try {
        for (const [key, change] of Object.entries(jobPending)) {
            const parts = key.split('_');
            const empId = parts[0];
            const dateStr = parts[1];
            const existing = jobShiftsMap[key];
            const existingCodeUpper = String(existing?.code || existing?.type || '').toUpperCase();
            const nextCodeUpper = String(change?.code || change?.type || '').toUpperCase();
            const existingEventoId = String(existing?.eventoId || '');
            const existingServicioId = String(existing?.servicioId || '');
            const nextEventoId = String(change?.eventoId || '');
            const nextServicioId = String(change?.servicioId || '');
            const empObj = employeesById[empId];
            const empName = empObj ? empObj.name : 'Desconocido';
            let actionType = 'ASIGNACION_MASIVA';
            let actionDetail = change.coveredBy
                ? `Cobertura ${change.code} — ${empName} cubierto por ${change.coveredBy} el ${dateStr}`
                : change.comments?.startsWith('Cubriendo a')
                    ? `${change.code} — ${change.comments} el ${dateStr}`
                    : ['V', 'L', 'PG', 'A', 'E', 'AA'].includes(change.code)
                        ? `${change.name || change.code} — ${empName} el ${dateStr}`
                        : `Asignó ${change.code} a ${empName} el ${dateStr}`;

            const allExistingIds = jobAllShiftIds[key] ?? (existing?.id ? [existing.id] : []);
            const deleteAllExisting = () => {
                for (const docId of allExistingIds) {
                    batch.delete(doc(db, 'turnos', docId));
                    bumpBatchOp();
                }
            };

            if (change.isDeleted) {
                actionType = 'ELIMINACION_MASIVA';
                actionDetail = `Borró turno de ${empName} el ${dateStr}`;
                if (existingCodeUpper === 'EV' && existingEventoId && existingServicioId) {
                    await rollbackEventoSolicitud(existingEventoId, existingServicioId, empId);
                }
                deleteAllExisting();

                if (correctionMode) {
                    const nonCoverageCodes = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'E', 'A', 'AA', 'PG', 'EV', 'RET']);
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const isFutureOrToday = dateStr >= todayStr;
                    if (!nonCoverageCodes.has(existingCodeUpper) && isFutureOrToday && existing?.startTime && existing?.endTime) {
                        const nowH = new Date().getHours();
                        const isTomorrow = dateStr > todayStr;
                        const actionTarget = (!isTomorrow || nowH >= 19) ? 'OPERACIONES' : 'PLANIFICACION';
                        const vacancyDoc: Record<string, unknown> = {
                            employeeId: 'VACANTE',
                            employeeName: 'VACANTE',
                            clientId: existing.clientId || selectedClient,
                            objectiveId: existing.objectiveId || resolveObjectiveForEmp(empId),
                            objectiveName: existing.objectiveName || '',
                            positionName: existing.positionName || 'General',
                            code: existingCodeUpper,
                            type: existing.type || existingCodeUpper,
                            startTime: existing.startTime,
                            endTime: existing.endTime,
                            scheduleDate: dateStr,
                            origin: 'VACANTE_CORRECCION',
                            vacancyOrigin: 'VACANTE_CORRECCION',
                            causedByShiftId: existing?.id || allExistingIds[0] || null,
                            causedByShiftIds: allExistingIds.length > 0 ? allExistingIds : null,
                            sourceShiftDeleted: true,
                            causedByEmployeeId: empId,
                            causedByEmployeeName: empName,
                            actionTarget,
                            isUnassigned: true,
                            draft: false,
                            createdAt: serverTimestamp(),
                            actorName: realActorName,
                        };
                        batch.set(doc(collection(db, 'turnos')), stampEmpresaId(vacancyDoc, empresaId));
                        bumpBatchOp();
                        await flushBatchWhenFull();
                    }
                }

                await registerPlanificacionCorreccion(
                    empId,
                    empName,
                    dateStr,
                    actionDetail,
                    existing?.code || '',
                    '(eliminado)',
                );
            } else {
                if (
                    existingCodeUpper === 'EV'
                    && existingEventoId
                    && existingServicioId
                    && (
                        nextCodeUpper !== 'EV'
                        || existingEventoId !== nextEventoId
                        || existingServicioId !== nextServicioId
                    )
                ) {
                    await rollbackEventoSolicitud(existingEventoId, existingServicioId, empId);
                }
                deleteAllExisting();
                await flushBatchWhenFull();

                if (existing) {
                    if ((existing.code === 'F' || existing.isFranco) && change.code !== 'F') {
                        if (change.isFrancoTrabajado) { actionType = 'CAMBIO_FRANCO_TURNO'; actionDetail = `Asignó FT (${change.code}) a ${empName} el ${dateStr}`; }
                        else { actionType = 'CAMBIO_DIAGRAMA'; actionDetail = `Cambio de Diagrama (F x ${change.code}) a ${empName}`; }
                    } else if (existing.code !== 'F' && change.code === 'F') {
                        if (change.isFrancoCompensatorio) { actionType = 'CAMBIO_TURNO_FRANCO'; actionDetail = `Asignó FF a ${empName} el ${dateStr}`; }
                    }
                }

                const [y, m, d] = dateStr.split('-').map(Number);
                const tDate = new Date(y, m - 1, d);
                const safePositionName = change.positionName || 'General';
                const [sh, sm] = getSafeTime(change.startTime);
                const start = new Date(tDate); start.setHours(sh, sm, 0);
                const end = new Date(start);

                if (change.code === 'F' || change.code === 'FF' || change.code === 'V') end.setHours(23, 59, 59);
                else if (typeof change.endTime === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(change.endTime)) {
                    const [eh, em] = change.endTime.split(':').map(Number);
                    end.setHours(eh, em, 0);
                    if (end.getTime() === start.getTime()) {
                        const hrs = Number(change.hours) > 0
                            ? Number(change.hours)
                            : (SHIFT_HOURS_LOOKUP[String(change.code || '').toUpperCase()] || 8);
                        end.setTime(start.getTime() + hrs * 3600000);
                    } else if (end < start) {
                        end.setTime(end.getTime() + 24 * 3600000);
                    }
                } else {
                    const slaSh = slaShiftByPosCode.get(`${safePositionName}__${String(change.code || '').toUpperCase()}`);
                    const slaEnd = typeof slaSh?.endTime === 'string' ? slaSh.endTime : null;
                    const slaHours = Number(slaSh?.hours) > 0 ? Number(slaSh.hours) : null;
                    if (slaEnd && /^\d{1,2}:\d{2}(:\d{2})?$/.test(slaEnd)) {
                        const [eh, em] = slaEnd.split(':').map(Number);
                        end.setHours(eh, em, 0);
                        if (end.getTime() === start.getTime()) {
                            const hrs = slaHours || Number(change.hours) || SHIFT_HOURS_LOOKUP[String(change.code || '').toUpperCase()] || 8;
                            end.setTime(start.getTime() + hrs * 3600000);
                        } else if (end < start) {
                            end.setTime(end.getTime() + 24 * 3600000);
                        }
                    } else if (slaHours) {
                        end.setTime(start.getTime() + slaHours * 3600000);
                    } else {
                        end.setTime(start.getTime() + ((change.hours != null ? change.hours : 8) * 3600000));
                    }
                }

                const safeSwapWith = change.swapWith || null;
                const safeSwapDate = change.swapDate || null;

                const turnoPayload: Record<string, unknown> = {
                    employeeId: empId,
                    employeeName: empName,
                    clientId: selectedClient,
                    objectiveId: change.objectiveId || resolveObjectiveForEmp(empId),
                    code: change.isFrancoCompensatorio ? 'FF' : change.code,
                    type: change.name || change.code,
                    startTime: Timestamp.fromDate(start),
                    endTime: Timestamp.fromDate(end),
                    scheduleDate: dateStr,
                    isFranco: change.code === 'F' || change.isFrancoCompensatorio || change.isFranco === true,
                    isFrancoTrabajado: change.isFrancoTrabajado || false,
                    isFrancoCompensatorio: change.isFrancoCompensatorio || false,
                    swapWith: safeSwapWith,
                    swapDate: safeSwapDate,
                    createdAt: serverTimestamp(),
                    comments: change.comments || change.coverageNote || 'Carga Masiva',
                    isExtended: change.isExtended || false,
                    isEarlyStart: change.isEarlyStart || false,
                    plannedNovedad: change.plannedNovedad || null,
                    positionName: safePositionName,
                    coveredBy: change.coveredBy || null,
                    draft: correctionMode ? false : !isPublished,
                    actorName: realActorName,
                    ...deploymentFieldsForFirestore(change),
                };

                if (
                    change.coveragePackageId
                    || change.coverageMode
                    || change.coversBandCode
                    || change.coversPositionName
                    || change.coverageSegmentRole
                    || change.coverageStatus
                    || change.isExtended
                    || change.isEarlyStart
                ) {
                    if (change.coveragePackageId) turnoPayload.coveragePackageId = change.coveragePackageId;
                    if (change.coverageType) turnoPayload.coverageType = change.coverageType;
                    if (change.coverageSegmentRole) turnoPayload.coverageSegmentRole = change.coverageSegmentRole;
                    if (change.coverageNote) turnoPayload.coverageNote = change.coverageNote;
                    if (change.coverageStatus) turnoPayload.coverageStatus = change.coverageStatus;
                    if (change.coverageMode) turnoPayload.coverageMode = change.coverageMode;
                    if (change.liberationReason) turnoPayload.liberationReason = change.liberationReason;
                    if (change.redeployNote) turnoPayload.redeployNote = change.redeployNote;
                    if (change.coversEmployeeId) turnoPayload.coversEmployeeId = change.coversEmployeeId;
                    if (change.coversPositionName) turnoPayload.coversPositionName = change.coversPositionName;
                    if (change.coversBandCode) turnoPayload.coversBandCode = change.coversBandCode;
                    if (change.segmentFromTime) turnoPayload.segmentFromTime = change.segmentFromTime;
                    if (change.segmentToTime) turnoPayload.segmentToTime = change.segmentToTime;
                }
                if (change.isExtended || change.isEarlyStart) {
                    if (!turnoPayload.segmentFromTime && change.segmentFromTime) {
                        turnoPayload.segmentFromTime = change.segmentFromTime;
                    }
                    if (!turnoPayload.segmentToTime && change.segmentToTime) {
                        turnoPayload.segmentToTime = change.segmentToTime;
                    }
                    if (change.extExtraHours != null && Number.isFinite(Number(change.extExtraHours))) {
                        turnoPayload.extExtraHours = Number(change.extExtraHours);
                    }
                }
                if (change.isRetiroAnticipado) {
                    turnoPayload.isRetiroAnticipado = true;
                    if (typeof change.adjustedEndTime === 'string' && /^\d{1,2}:\d{2}$/.test(change.adjustedEndTime)) {
                        turnoPayload.adjustedEndTime = change.adjustedEndTime;
                    }
                    if (change.originalEndTime) turnoPayload.originalEndTime = change.originalEndTime;
                }
                if (change.isEarlyStart && typeof change.adjustedStartTime === 'string' && /^\d{1,2}:\d{2}$/.test(change.adjustedStartTime)) {
                    const [ah, am] = change.adjustedStartTime.split(':').map(Number);
                    const adj = new Date(tDate);
                    adj.setHours(ah, am, 0, 0);
                    turnoPayload.adjustedStartTime = Timestamp.fromDate(adj);
                }
                if (change.isExtended && typeof change.adjustedEndTime === 'string' && /^\d{1,2}:\d{2}$/.test(change.adjustedEndTime)) {
                    turnoPayload.extensionEndTime = change.adjustedEndTime;
                }
                if (change.extExtraHours != null && Number.isFinite(Number(change.extExtraHours))) {
                    turnoPayload.extExtraHours = Number(change.extExtraHours);
                }
                if (change.shiftGroupId) turnoPayload.shiftGroupId = change.shiftGroupId;
                if (change.isSecondBlock) turnoPayload.isSecondBlock = true;
                if (change.eventoId) {
                    turnoPayload.eventoId = change.eventoId;
                    turnoPayload.eventoNombre = change.eventoNombre || null;
                    turnoPayload.servicioId = change.servicioId || null;
                    turnoPayload.servicioNombre = change.servicioNombre || null;
                    if (change.hours != null && Number.isFinite(Number(change.hours)) && Number(change.hours) > 0) {
                        turnoPayload.hours = Number(change.hours);
                    }
                }

                batch.set(doc(collection(db, 'turnos')), stampEmpresaId(turnoPayload, empresaId));
                bumpBatchOp();
                await flushBatchWhenFull();
                if (nextCodeUpper === 'EV' && nextEventoId && nextServicioId) {
                    await approveEventoSolicitud(change, empId, empName, dateStr);
                }

                if (correctionMode) {
                    const codigoNuevo = change.isFrancoCompensatorio ? 'FF' : change.code;
                    await registerPlanificacionCorreccion(
                        empId,
                        empName,
                        dateStr,
                        actionDetail,
                        existing?.code || '',
                        codigoNuevo,
                    );
                } else {
                    logData.push({ empId, date: dateStr, action: actionType, detail: actionDetail });
                }
            }
            await flushBatchWhenFull();
        }

        if (isPublished && !correctionMode && logData.length > 0) {
            if (logData.length >= AUDIT_CONSOLIDATE_MIN) {
                batch.set(doc(collection(db, 'audit_logs')), stampEmpresaId({
                    action: 'ASIGNACION_MASIVA',
                    module: 'PLANIFICADOR',
                    details: `Guardado masivo: ${logData.length} celdas en ${getObjectiveName(selectedObjective)}`,
                    timestamp: serverTimestamp(),
                    actorName: realActorName,
                    actorUid: auth.currentUser?.uid,
                    objectiveId: selectedObjective,
                    objectiveName: getObjectiveName(selectedObjective),
                    clientId: selectedClient || undefined,
                }, empresaId));
                bumpBatchOp();
            } else {
                for (const entry of logData) {
                    batch.set(doc(collection(db, 'audit_logs')), stampEmpresaId({
                        action: entry.action,
                        module: 'PLANIFICADOR',
                        details: entry.detail,
                        timestamp: serverTimestamp(),
                        actorName: realActorName,
                        actorUid: auth.currentUser?.uid,
                        objectiveId: selectedObjective,
                        objectiveName: getObjectiveName(selectedObjective),
                        clientId: selectedClient || undefined,
                    }, empresaId));
                    bumpBatchOp();
                }
            }
            await flushBatchWhenFull();
        }

        await flushBatch();

        if (empresaId && selectedObjective) {
            const touchYear = currentDate.getFullYear();
            const touchMonth = currentDate.getMonth() + 1;
            void touchPlanificacionEstadoActivity({
                empresaId,
                objectiveId: selectedObjective,
                year: touchYear,
                month: touchMonth,
                actorName: realActorName,
            }).catch((err) => console.warn('[plan] touch lastModified', err));
        }

        if (isPublished) {
            setNeedsRepublishMap(prev => ({ ...prev, [publishLookupKey]: true }));
        }
        planToastSaved(jobCount);

        const postSaveTasks: Promise<unknown>[] = [
            addDoc(collection(db, 'planificaciones_historial'), {
                timestamp: serverTimestamp(),
                user: realActorName,
                period: `${currentDate.getMonth() + 1}-${currentDate.getFullYear()}`,
                objectiveId: selectedObjective,
                changes: logData,
                count: jobCount,
                snapshot: JSON.stringify(snapshotData),
            }).catch((err) => { console.warn('[plan] historial', err); }),
        ];

        if (isPublished && empresaId) {
            const objName = getObjectiveName(selectedObjective);
            const packages = [
                ...savedRecompositionPackages,
                ...extractPackagesFromPending(savedPendingChanges, employeesById, selectedObjective),
            ];
            const seenPkg = new Set<string>();
            for (const pkg of packages) {
                if (seenPkg.has(pkg.id)) continue;
                seenPkg.add(pkg.id);
                const extName = pkg.extension?.employeeId
                    ? (employeesById[pkg.extension.employeeId]?.name || pkg.extension.employeeId)
                    : '';
                const adelName = employeesById[pkg.earlyStart.employeeId]?.name || pkg.earlyStart.employeeId;
                const targetName = employeesById[pkg.target.employeeId]?.name || pkg.target.employeeId;
                postSaveTasks.push(
                    emitRecompositionNotifications(pkg, {
                        empresaId,
                        clientId: selectedClient,
                        objectiveId: selectedObjective,
                        objectiveName: objName,
                        extName,
                        adelName,
                        targetName,
                    }).catch((notifyErr) => {
                        console.warn('[plan] cobertura notify', notifyErr);
                    }),
                );
            }
        }

        const experienciaPatches = new Map<string, Record<string, unknown>>();
        for (const [key, change] of Object.entries(savedPendingChanges)) {
            if (change.isDeleted) continue;
            const code = String(change.code || '').toUpperCase();
            if (code !== 'REF' && code !== 'ESC') continue;
            const empId = key.split('_')[0];
            const empObj = employeesById[empId];
            if (!empObj || !selectedObjective) continue;
            const prev = (empObj.experienciaObjetivos || {}) as Record<string, unknown>;
            const next = patchExperienciaForTurno(
                prev as any,
                selectedObjective,
                { ...change, ...deploymentFieldsForFirestore(change) },
                empObj.preferredObjectiveId,
            );
            experienciaPatches.set(empId, next);
        }
        if (experienciaPatches.size > 0) {
            postSaveTasks.push(
                Promise.all(
                    [...experienciaPatches.entries()].map(([empId, exp]) =>
                        updateDoc(doc(db, 'empleados', empId), { experienciaObjetivos: exp }).catch(() => {}),
                    ),
                ),
            );
        }

        const novedades = Object.values(savedPendingNovedades);
        if (novedades.length > 0) {
            postSaveTasks.push((async () => {
                let ausBatch = writeBatch(db);
                let ausOps = 0;
                for (const novedad of novedades) {
                    ausBatch.set(
                        doc(collection(db, 'ausencias')),
                        stampEmpresaId({ ...novedad, createdAt: serverTimestamp() }, empresaId),
                    );
                    ausOps++;
                    if (ausOps >= BATCH_LIMIT) {
                        await ausBatch.commit();
                        ausBatch = writeBatch(db);
                        ausOps = 0;
                    }
                }
                if (ausOps > 0) await ausBatch.commit();
            })());
        }

        void Promise.all(postSaveTasks).catch((postErr) => {
            console.warn('[plan] post-save', postErr);
            toast.warning('Turnos guardados; historial o notificaciones pendientes de sincronizar.');
        });
        if (empresaId && selectedObjective) {
            const y = currentDate.getFullYear();
            const m = currentDate.getMonth() + 1;
            const oid = selectedObjective;
            void rebuildHoursBalanceForObjectiveMonth({
                empresaId,
                objectiveId: oid,
                year: y,
                month: m,
                scopeEmpresa,
                rebuiltFrom: 'planning',
            }).catch((err) => console.warn('[plan] hours_balances', err));
        }
    } catch (e) {
        console.error(e);
        restorePendingOnFailure();
        planToastSaveError();
    } finally {
        setBackgroundSaveCount((c) => Math.max(0, c - 1));
    }
}
