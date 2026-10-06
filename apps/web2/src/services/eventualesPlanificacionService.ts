/**
 * Cliente de las callables de eventuales en Planificación / Eventos.
 * El servidor valida permiso EVENTUALES.convocar, cruce 12 h del grupo y escribe legajo, turnos y contrato.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { JornadaEventual } from '@/components/eventuales/EventualesCandidatosPanel';

export type TurnoEventualIn = JornadaEventual & { code: string; name?: string; positionName?: string };

export type AsignarEventualParams = {
    empresaId: string;
    cuil: string;
    objectiveId?: string | null;
    objectiveName?: string | null;
    clientId?: string | null;
    clientName?: string | null;
    positionName?: string | null;
    objetivoGeo?: { lat: number; lng: number } | null;
    turnos: TurnoEventualIn[];
    /** 'LEGAJO': solo crea/devuelve el legajo; la grilla guarda los turnos. 'TURNOS': el servidor escribe los turnos. */
    modo?: 'LEGAJO' | 'TURNOS';
    cubreA?: { employeeId: string; employeeName: string; shiftIds?: string[] } | null;
    evento?: { eventoId: string; eventoNombre: string; servicioId: string; servicioNombre: string } | null;
};

export type AsignarEventualResult = {
    ok: boolean;
    employeeId: string;
    nombre?: string;
    turnoIds?: string[];
    contratos?: { accion: string; contratoId: string; estado: string | null }[];
};

export type SustituirEventualParams = {
    empresaId: string;
    cuilTitular: string;
    cuilSustituto: string;
    desdeFecha: string;
    hastaFecha?: string;
    objectiveId?: string | null;
    clientId?: string | null;
    objetivoGeo?: { lat: number; lng: number } | null;
};

export function canConvocarEventuales(isSuperAdmin: boolean, rolePermissions: Record<string, string[]> | undefined | null): boolean {
    if (isSuperAdmin) return true;
    return (rolePermissions?.EVENTUALES || []).includes('convocar');
}

/** Consulta de disponibilidad: convocar eventuales o actualizar la planificación. */
export function canConsultarDisponibilidad(isSuperAdmin: boolean, rolePermissions: Record<string, string[]> | undefined | null): boolean {
    if (isSuperAdmin) return true;
    if ((rolePermissions?.EVENTUALES || []).includes('convocar')) return true;
    return (rolePermissions?.PLANNING || []).includes('update');
}

export async function asignarEventualPlanificacion(params: AsignarEventualParams): Promise<AsignarEventualResult> {
    const call = httpsCallable<AsignarEventualParams, AsignarEventualResult>(functions, 'asignarEventualPlanificacion');
    const res = await call(params);
    return res.data;
}

export type ConvocarEventualEventoParams = {
    empresaId: string;
    cuil: string;
    jornada: JornadaEventual;
    evento: { eventoId: string; eventoNombre: string; servicioId: string; servicioNombre: string };
    clientId?: string | null;
    clientName?: string | null;
    positionName?: string | null;
    objetivoGeo?: { lat: number; lng: number } | null;
};

export type ConvocarEventualEventoResult = {
    ok: boolean;
    solicitudId: string;
    employeeId: string;
    /** Momento (ms) en que vence si no responde: queda «Venció» y el lugar libre. */
    venceAt: number;
    pruebasSinMarco: boolean;
};

/**
 * Desde el evento el eventual se CONVOCA (nunca asignación directa): nace la solicitud `convocado`
 * y el push con Aceptar / Rechazar. Turno EV, contrato, AT y anexo recién cuando acepta en la app.
 */
export async function convocarEventualEvento(params: ConvocarEventualEventoParams): Promise<ConvocarEventualEventoResult> {
    const call = httpsCallable<ConvocarEventualEventoParams, ConvocarEventualEventoResult>(functions, 'convocarEventualEvento');
    const res = await call(params);
    return res.data;
}

export async function sustituirEventualPlanificacion(params: SustituirEventualParams): Promise<{ ok: boolean; employeeId: string; turnoIds: string[] }> {
    const call = httpsCallable<SustituirEventualParams, { ok: boolean; employeeId: string; turnoIds: string[] }>(functions, 'sustituirEventualPlanificacion');
    const res = await call(params);
    return res.data;
}

/** Mensaje legible de un error de callable (failed-precondition trae el motivo del cruce). */
export function eventualErrorMessage(e: unknown, fallback = 'No se pudo asignar al eventual.'): string {
    const msg = String((e as { message?: string })?.message || '').trim();
    return msg && msg !== 'internal' ? msg : fallback;
}
