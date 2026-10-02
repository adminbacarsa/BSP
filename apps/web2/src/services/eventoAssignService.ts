import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

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
