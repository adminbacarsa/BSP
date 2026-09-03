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
    Timestamp,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { stampEmpresaId } from '@/lib/multiempresa';

export interface AssignGuardToEventParams {
    empresaId: string;
    empleadoId: string;
    empleadoNombre: string;
    empleadoObjectiveId?: string;
    empleadoObjectiveName?: string;
    eventoId: string;
    eventoNombre: string;
    clienteId?: string;
    clienteNombre?: string;
    servicioId: string;
    servicioNombre: string;
    servicioFecha: string;
    horaInicio: string;
    horaFin: string;
    horas: number;
    solicitudId?: string;
    respondidoPor?: string;
    notifyPlannerUid?: string;
}

const AR_OFFSET = '-03:00';

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

function arDateTimeTs(fecha: string, hhmm: string): Timestamp {
    const time = /^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm : '08:00';
    const [hRaw, mRaw] = time.split(':');
    return Timestamp.fromDate(
        new Date(`${fecha}T${pad2(Number(hRaw))}:${pad2(Number(mRaw))}:00.000${AR_OFFSET}`),
    );
}

function arDayBounds(fecha: string) {
    return {
        startTs: Timestamp.fromDate(new Date(`${fecha}T00:00:00.000${AR_OFFSET}`)),
        endTs: Timestamp.fromDate(new Date(`${fecha}T23:59:59.999${AR_OFFSET}`)),
        startStr: `${fecha}T00:00:00`,
        endStr: `${fecha}T23:59:59`,
    };
}

/**
 * Asigna un guardia a un evento.
 * Escribe startTime/endTime como Timestamp (la app móvil consulta por Timestamp).
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
    } = params;

    const { startTs, endTs, startStr, endStr } = arDayBounds(servicioFecha);
    const base = query(collection(db, 'turnos'), where('employeeId', '==', empleadoId));
    const [tsSnap, strSnap] = await Promise.all([
        getDocs(query(base, where('startTime', '>=', startTs), where('startTime', '<=', endTs))),
        getDocs(query(base, where('startTime', '>=', startStr), where('startTime', '<=', endStr))),
    ]);

    const byId = new Map<string, QueryDocumentSnapshot>();
    for (const d of [...tsSnap.docs, ...strSnap.docs]) {
        if (empresaId && d.data().empresaId && String(d.data().empresaId) !== empresaId) continue;
        byId.set(d.id, d);
    }

    const existingTurno = [...byId.values()].find(d => {
        const c = String(d.data().code || '').toUpperCase();
        return c !== 'EV' && c !== 'F' && c !== 'FF' && c !== 'FP';
    }) ?? null;

    const originalCode = existingTurno
        ? String(existingTurno.data().code || '').toUpperCase()
        : null;
    const existingTurnoData = (existingTurno?.data() || {}) as Record<string, unknown>;
    const isPassiveRetention = originalCode === 'RET'
        || String(existingTurnoData.origin || '').toUpperCase() === 'RETEN'
        || existingTurnoData.isReten === true;

    let originalObjectiveId: string | null = existingTurno?.data().objectiveId || empleadoObjectiveId || null;
    let originalObjectiveName: string | null = existingTurno?.data().objectiveName || empleadoObjectiveName || null;

    if (!originalObjectiveId) {
        try {
            const empSnap = await getDoc(doc(db, 'empleados', empleadoId));
            if (empSnap.exists()) {
                const empData = empSnap.data() as any;
                originalObjectiveId = empData.preferredObjectiveId || empData.objectiveId || null;
                originalObjectiveName = empData.preferredObjectiveName || empData.objectiveName || null;
            }
        } catch { /* continuar */ }
    }

    let startTime = arDateTimeTs(servicioFecha, horaInicio);
    let endTime = arDateTimeTs(servicioFecha, horaFin);
    if (endTime.toMillis() <= startTime.toMillis()) {
        endTime = Timestamp.fromDate(new Date(endTime.toDate().getTime() + 24 * 60 * 60 * 1000));
    }

    const batch = writeBatch(db);

    if (existingTurno) {
        batch.update(existingTurno.ref, {
            code: 'EV',
            origin: 'EVENTO',
            eventoId,
            eventoNombre,
            servicioId,
            servicioNombre,
            startTime,
            endTime,
            hours: horas,
            isPresent:   false,
            isAbsent:    false,
            isCompleted: false,
            draft:       false,
            replacedCode: originalCode,
        });
    } else {
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
            startTime,
            endTime,
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

    if (solicitudId) {
        batch.update(doc(db, 'solicitudes_evento', solicitudId), {
            status: 'aprobada',
            respondidoAt: serverTimestamp(),
            ...(respondidoPor ? { respondidoPor } : {}),
        });
    }

    const shouldCreateVacancyByEvent = !!existingTurno && !!originalObjectiveId && !isPassiveRetention;
    if (shouldCreateVacancyByEvent) {
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
