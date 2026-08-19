import { db } from '@/lib/firebase';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    query,
    where,
    getDocs,
    serverTimestamp,
    orderBy,
} from 'firebase/firestore';
import { stampEmpresaId } from '@/lib/multiempresa';

export type EstadoSolicitudEvento = 'pendiente' | 'convocado' | 'aprobada' | 'rechazada' | 'cerrada' | 'reserva';
export type TipoSolicitudEvento = 'guardia_solicita' | 'admin_convoca';

export interface SolicitudEvento {
    id?: string;
    empresaId: string;
    eventoId: string;
    eventoNombre: string;
    servicioId: string;
    servicioNombre: string;
    servicioFecha: string;           // YYYY-MM-DD
    empleadoId: string;
    empleadoNombre: string;
    tipo: TipoSolicitudEvento;       // quién inició
    status: EstadoSolicitudEvento;
    nota?: string;
    convocadoPor?: string;           // uid del admin que convocó
    respondidoAt?: any;
    respondidoPor?: string;
    creadoAt?: any;
}

export const solicitudEventoService = {
    /** Guardia solicita participar en un evento. */
    add: async (data: Omit<SolicitudEvento, 'id' | 'tipo' | 'status' | 'creadoAt'>): Promise<string> => {
        const payload = stampEmpresaId(
            {
                ...data,
                tipo: 'guardia_solicita' as TipoSolicitudEvento,
                status: 'pendiente' as EstadoSolicitudEvento,
                creadoAt: serverTimestamp(),
            } as Record<string, unknown>,
            data.empresaId,
        );
        const ref = await addDoc(collection(db, 'solicitudes_evento'), payload);
        return ref.id;
    },

    /** Admin convoca a un guardia a un servicio de evento. */
    convocar: async (data: {
        empresaId: string;
        eventoId: string;
        eventoNombre: string;
        servicioId: string;
        servicioNombre: string;
        servicioFecha: string;
        empleadoId: string;
        empleadoNombre: string;
        convocadoPor?: string;
    }): Promise<string> => {
        const payload = stampEmpresaId(
            {
                ...data,
                tipo: 'admin_convoca' as TipoSolicitudEvento,
                status: 'convocado' as EstadoSolicitudEvento,
                creadoAt: serverTimestamp(),
            } as Record<string, unknown>,
            data.empresaId,
        );
        const ref = await addDoc(collection(db, 'solicitudes_evento'), payload);
        return ref.id;
    },

    /** Admin responde una solicitud (aprobada / rechazada). */
    responder: async (
        id: string,
        status: 'aprobada' | 'rechazada',
        respondidoPor: string,
        nota?: string,
    ): Promise<void> => {
        await updateDoc(doc(db, 'solicitudes_evento', id), {
            status,
            respondidoPor,
            nota: nota || null,
            respondidoAt: serverTimestamp(),
        });
    },

    /** Guardia responde a una convocatoria del admin. */
    responderConvocatoria: async (
        id: string,
        status: 'aprobada' | 'rechazada',
    ): Promise<void> => {
        await updateDoc(doc(db, 'solicitudes_evento', id), {
            status,
            respondidoAt: serverTimestamp(),
        });
    },

    /** Carga todas las solicitudes de un evento (panel admin). */
    getByEvento: async (eventoId: string): Promise<SolicitudEvento[]> => {
        const q = query(
            collection(db, 'solicitudes_evento'),
            where('eventoId', '==', eventoId),
            orderBy('creadoAt', 'desc'),
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as SolicitudEvento));
    },

    /** Carga solicitudes del empleado en un rango de fechas (portal guardia). */
    getByEmpleado: async (empleadoId: string, empresaId: string, fromDate: string, toDate: string): Promise<SolicitudEvento[]> => {
        const q = query(
            collection(db, 'solicitudes_evento'),
            where('empresaId', '==', empresaId),
            where('empleadoId', '==', empleadoId),
            where('servicioFecha', '>=', fromDate),
            where('servicioFecha', '<=', toDate),
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as SolicitudEvento));
    },
};
