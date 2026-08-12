import { db, getDocsOnce } from '@/lib/firebase';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
} from 'firebase/firestore';
import { stampEmpresaId } from '@/lib/multiempresa';

export interface Evento {
    id?: string;
    empresaId: string;
    nombre: string;
    descripcion?: string;
    clienteId: string;
    clienteNombre: string;
    /** Fecha principal YYYY-MM-DD */
    fecha: string;
    /** Fechas adicionales YYYY-MM-DD[] para eventos de múltiples días */
    fechas?: string[];
    horaInicio: string;
    horaFin: string;
    horasEvento: number;
    cupoGuardias: number;
    status: 'activo' | 'cancelado' | 'ejecutado';
    creadoPor?: string;
    creadoAt?: any;
}

/** Devuelve todos los eventos de una empresa cuya fecha principal cae en el rango dado. */
export const eventoService = {
    getByEmpresaAndRange: async (empresaId: string, fromDate: string, toDate: string): Promise<Evento[]> => {
        try {
            const q = query(
                collection(db, 'eventos'),
                where('empresaId', '==', empresaId),
                where('fecha', '>=', fromDate),
                where('fecha', '<=', toDate),
                orderBy('fecha'),
            );
            const snap = await getDocsOnce(q);
            // Filtramos cancelados en cliente para evitar el operador != con range
            return snap.docs
                .map(d => ({ id: d.id, ...d.data() } as Evento))
                .filter(ev => ev.status !== 'cancelado');
        } catch (e) {
            console.error('Error cargando eventos:', e);
            return [];
        }
    },

    add: async (data: Omit<Evento, 'id'>): Promise<string> => {
        const payload = stampEmpresaId({ ...data, creadoAt: serverTimestamp() } as Record<string, unknown>, data.empresaId);
        const ref = await addDoc(collection(db, 'eventos'), payload);
        return ref.id;
    },

    update: async (id: string, data: Partial<Evento>): Promise<void> => {
        await updateDoc(doc(db, 'eventos', id), data as Record<string, unknown>);
    },

    cancel: async (id: string): Promise<void> => {
        await updateDoc(doc(db, 'eventos', id), { status: 'cancelado' });
    },
};

/** Devuelve los eventos activos que incluyen la fecha dada (fecha principal o fechas adicionales). */
export function eventosParaFecha(eventos: Evento[], fecha: string): Evento[] {
    return eventos.filter(ev =>
        ev.status === 'activo' &&
        (ev.fecha === fecha || (ev.fechas || []).includes(fecha)),
    );
}

/** Calcula las horas de un evento a partir de horaInicio y horaFin. */
export function calcHorasEvento(horaInicio: string, horaFin: string): number {
    const [sh, sm] = horaInicio.split(':').map(Number);
    const [eh, em] = horaFin.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    return Math.round(mins / 60);
}
