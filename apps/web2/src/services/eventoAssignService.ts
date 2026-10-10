import { httpsCallable } from 'firebase/functions';
import { addDoc, collection, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { grupoDeGenero } from '@/lib/eventuales/cupoGenero.mjs';
import type { Evento, ServicioEvento } from '@/services/eventoService';

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

/**
 * El turno EV lo escribe el servidor (`asignarGuardiaEvento` → `escribirTurnoEvento`).
 * El panel no arma el documento.
 */
export async function assignGuardToEvent(params: AssignGuardToEventParams): Promise<void> {
    const fn = httpsCallable(functions, 'asignarGuardiaEvento');
    await fn(params);
}

export function horasDeServicioEvento(s: Pick<ServicioEvento, 'tipoTurno' | 'horaInicio' | 'horaFin'>): number {
    if (s.tipoTurno === '3x8') return 8;
    if (s.tipoTurno === '2x12') return 12;
    const [sh, sm] = String(s.horaInicio || '08:00').split(':').map(Number);
    const [eh, em] = String(s.horaFin || '16:00').split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    return Math.max(1, Math.round(mins / 60));
}

export type EmpleadoParaEvento = {
    id: string;
    name: string;
    genero?: string;
    preferredObjectiveId?: string;
    preferredObjectiveName?: string;
    objectiveId?: string;
    objectiveName?: string;
};

/**
 * Asignación directa de un guardia de nómina a un servicio de evento, igual que «Asignar» en el detalle del evento:
 * solicitud `admin_asigna` aprobada + `asignarGuardiaEvento` (el servidor cuenta el cupo en transacción).
 * Si el servidor rechaza (cupo completo, se pisa), la solicitud no queda.
 */
export async function asignarNominaAServicioEvento(p: {
    empresaId: string;
    evento: Evento;
    servicio: ServicioEvento;
    empleado: EmpleadoParaEvento;
    convocadoPor: string;
}): Promise<void> {
    const { empresaId, evento, servicio, empleado, convocadoPor } = p;
    if (!evento.id) throw new Error('Evento sin id');
    const grupo = grupoDeGenero(servicio, empleado.genero) as string | null;
    const solicitudRef = await addDoc(collection(db, 'solicitudes_evento'), {
        empresaId,
        eventoId: evento.id,
        eventoNombre: evento.nombre,
        servicioId: servicio.id,
        servicioNombre: servicio.nombre,
        servicioFecha: servicio.fecha,
        empleadoId: empleado.id,
        empleadoNombre: empleado.name,
        status: 'aprobada',
        tipo: 'admin_asigna',
        convocadoPor,
        respondidoPor: convocadoPor,
        genero: empleado.genero || '',
        cupoGrupo: grupo || 'TODOS',
        origen: 'PLANIFICACION_PEGADO',
        respondidoAt: serverTimestamp(),
        creadoAt: serverTimestamp(),
    });
    try {
        await assignGuardToEvent({
            empresaId,
            empleadoId: empleado.id,
            empleadoNombre: empleado.name,
            empleadoObjectiveId: empleado.preferredObjectiveId || empleado.objectiveId || undefined,
            empleadoObjectiveName: empleado.preferredObjectiveName || empleado.objectiveName || undefined,
            eventoId: evento.id,
            eventoNombre: evento.nombre,
            clienteId: evento.clienteId,
            clienteNombre: evento.clienteNombre,
            servicioId: servicio.id,
            servicioNombre: servicio.nombre,
            servicioFecha: servicio.fecha,
            horaInicio: servicio.horaInicio,
            horaFin: servicio.horaFin,
            horas: horasDeServicioEvento(servicio),
            solicitudId: solicitudRef.id,
            respondidoPor: convocadoPor,
        });
    } catch (e) {
        await deleteDoc(solicitudRef).catch(() => {});
        throw e;
    }
}
