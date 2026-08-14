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

export type EstadoSolicitudEvento = 'pendiente' | 'aprobada' | 'rechazada';

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
    status: EstadoSolicitudEvento;
    nota?: string;
    respondidoAt?: any;
    respondidoPor?: string;
    creadoAt?: any;
}

export const solicitudEventoService = {
    /** Crea una solicitud del guardia para un servicio de evento. */
    add: async (data: Omit<SolicitudEvento, 'id' | 'status' | 'creadoAt'>): Promise<string> => {
        const payload = stampEmpresaId(
            {
                ...data,
                status: 'pendiente',
                creadoAt: serverTimestamp(),
            } as Record<string, unknown>,
            data.empresaId,
        );
        const ref = await addDoc(collection(db, 'solicitudes_evento'), payload);
        return ref.id;
    },

    /** Responde una solicitud (aprobada / rechazada). */
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

    /** Carga solicitudes de un evento (para el panel admin). */
    getByEvento: async (eventoId: string): Promise<SolicitudEvento[]> => {
        const q = query(
            collection(db, 'solicitudes_evento'),
            where('eventoId', '==', eventoId),
            orderBy('creadoAt', 'desc'),
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as SolicitudEvento));
    },

    /** Carga solicitudes del empleado para el mes actual (para el portal guardia). */
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
