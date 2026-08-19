import { db } from '@/lib/firebase';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    writeBatch,
    serverTimestamp,
} from 'firebase/firestore';
import { stampEmpresaId } from '@/lib/multiempresa';

export interface AssignGuardToEventParams {
    empresaId: string;
    // Guardia
    empleadoId: string;
    empleadoNombre: string;
    empleadoObjectiveId?: string;   // objetivo habitual del guardia
    empleadoObjectiveName?: string;
    // Evento / servicio
    eventoId: string;
    eventoNombre: string;
    clienteId?: string;
    clienteNombre?: string;
    servicioId: string;
    servicioNombre: string;
    servicioFecha: string;          // YYYY-MM-DD
    horaInicio: string;
    horaFin: string;
    horas: number;
    // Opcional: solicitud a marcar 'aprobada'
    solicitudId?: string;
    respondidoPor?: string;         // uid del admin que aprueba (flujo admin)
    // Opcional: notificar al planificador sobre la vacante generada
    notifyPlannerUid?: string;
}

/**
 * Asigna un guardia a un evento.
 *
 * Batch atómico:
 *   1. Busca turno existente del guardia en esa fecha
 *   2. Actualiza ese turno a EV (o crea uno nuevo si no tenía)
 *   3. Actualiza solicitudes_evento a 'aprobada' (si viene del flujo convocatoria)
 *   4. Crea notificación a planificación sobre la vacante generada
 */
export async function assignGuardToEvent(params: AssignGuardToEventParams): Promise<void> {
    const {
        empresaId,
        empleadoId, empleadoNombre,
        empleadoObjectiveId, empleadoObjectiveName,
        eventoId, eventoNombre, clienteId, clienteNombre,
        servicioId, servicioNombre, servicioFecha,
        horaInicio, horaFin, horas,
        solicitudId, respondidoPor,
        notifyPlannerUid,
    } = params;

    // 1. Buscar turno existente del guardia en esa fecha
    const turnosSnap = await getDocs(query(
        collection(db, 'turnos'),
        where('empresaId', '==', empresaId),
        where('employeeId', '==', empleadoId),
        where('startTime', '>=', `${servicioFecha}T00:00:00`),
        where('startTime', '<=', `${servicioFecha}T23:59:59`),
    ));

    // Ignorar turnos ya EV (duplicado) y francos (no generan vacante operativa)
    const existingTurno = turnosSnap.docs.find(d => {
        const c = String(d.data().code || '').toUpperCase();
        return c !== 'EV' && c !== 'F' && c !== 'FF' && c !== 'FP';
    }) ?? null;

    const originalCode = existingTurno
        ? String(existingTurno.data().code || '').toUpperCase()
        : null;

    let originalObjectiveId: string | null = existingTurno?.data().objectiveId || empleadoObjectiveId || null;
    let originalObjectiveName: string | null = existingTurno?.data().objectiveName || empleadoObjectiveName || null;

    // Si no tenemos objectiveId (guardia sin turno ese día y sin objetivo pasado),
    // consultamos el documento del empleado para obtener su objetivo habitual.
    if (!originalObjectiveId) {
        try {
            const empSnap = await getDoc(doc(db, 'empleados', empleadoId));
            if (empSnap.exists()) {
                const empData = empSnap.data() as any;
                originalObjectiveId = empData.preferredObjectiveId || empData.objectiveId || null;
                originalObjectiveName = empData.preferredObjectiveName || empData.objectiveName || null;
            }
        } catch { /* continuar con null si falla */ }
    }

    const batch = writeBatch(db);

    // 2a. Si tiene turno ese día: actualizarlo a EV conservando el docId
    if (existingTurno) {
        batch.update(existingTurno.ref, {
            code: 'EV',
            origin: 'EVENTO',
            eventoId,
            eventoNombre,
            servicioId,
            servicioNombre,
            startTime: `${servicioFecha}T${horaInicio}:00`,
            endTime:   `${servicioFecha}T${horaFin}:00`,
            hours: horas,
            isPresent:   false,
            isAbsent:    false,
            isCompleted: false,
            draft:       false,
            replacedCode: originalCode,
        });
    } else {
        // 2b. No tenía turno ese día — crear turno EV nuevo
        const payload = stampEmpresaId({
            code: 'EV',
            origin: 'EVENTO',
            employeeId: empleadoId,
            employeeName: empleadoNombre,
            objectiveId:   originalObjectiveId,
            objectiveName: originalObjectiveName,
            clientId:   clienteId   || null,
            clientName: clienteNombre || null,
            eventoId,
            eventoNombre,
            servicioId,
            servicioNombre,
            startTime: `${servicioFecha}T${horaInicio}:00`,
            endTime:   `${servicioFecha}T${horaFin}:00`,
            hours: horas,
            isPresent:   false,
            isAbsent:    false,
            isCompleted: false,
            draft:       false,
            replacedCode: null,
            createdAt: serverTimestamp(),
        } as Record<string, unknown>, empresaId);
        batch.set(doc(collection(db, 'turnos')), payload);
    }

    // 3. Actualizar solicitud_evento → 'aprobada'
    if (solicitudId) {
        batch.update(doc(db, 'solicitudes_evento', solicitudId), {
            status: 'aprobada',
            respondidoAt: serverTimestamp(),
            ...(respondidoPor ? { respondidoPor } : {}),
        });
    }

    // 4. Notificación a planificación sobre la vacante (en 'novedades' para que aparezca en el bell panel)
    if (originalObjectiveId) {
        const [y, m, d2] = servicioFecha.split('-');
        const fechaLabel = `${d2}/${m}/${y}`;
        const notifPayload = stampEmpresaId({
            type:         'VACANTE_POR_EVENTO',
            status:       'pending',
            viewed:       false,
            priority:     'high',
            actionTarget: 'PLANIFICACION',
            title:        `Vacante por evento · ${empleadoNombre}`,
            description:  `${empleadoNombre} sale al evento "${eventoNombre}" el ${fechaLabel}. `
                + `Queda vacante turno ${originalCode || '—'} en ${originalObjectiveName || originalObjectiveId}.`,
            objectiveId:   originalObjectiveId,
            objectiveName: originalObjectiveName,
            fecha:         servicioFecha,
            codigoTurnoOriginal: originalCode,
            employeeId:    empleadoId,
            employeeName:  empleadoNombre,
            eventoId,
            eventoNombre,
            createdAt: serverTimestamp(),
        } as Record<string, unknown>, empresaId);
        batch.set(doc(collection(db, 'novedades')), notifPayload);
    }

    await batch.commit();
}
