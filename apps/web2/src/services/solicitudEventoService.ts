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

/** `vencida` = convocatoria de eventual sin respuesta en el plazo (`venceAt`): no generó nada, el lugar quedó libre. */
/** `cupo_completo` = el cupo de su grupo se llenó antes de que respondiera (se le avisó; no se generó nada). */
export type EstadoSolicitudEvento = 'pendiente' | 'convocado' | 'aprobada' | 'rechazada' | 'cerrada' | 'reserva' | 'vencida' | 'cancelada' | 'cupo_completo';
/** `admin_asigna` = asignación directa desde Eventos (libre/RET): nace `aprobada`, no es una aceptación. */
export type TipoSolicitudEvento = 'guardia_solicita' | 'admin_convoca' | 'admin_asigna';

/** Estado del anexo al marco de una convocatoria de eventual (lo escribe el servidor). */
export type AnexoEstadoSolicitud = 'PENDIENTE_ACEPTACION' | 'PENDIENTE' | 'FIRMADO' | 'SIN_CANAL' | 'NO_EXIGIDO';

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
    /** Convocatoria de un eventual de la bolsa (`convocarEventualEvento`). */
    esEventual?: boolean;
    bolsaCuil?: string;
    /** Ficha con «Exigir contrato marco y habilitación» en OFF. */
    pruebasSinMarco?: boolean;
    etiquetasPruebas?: string[];
    anexoEstado?: AnexoEstadoSolicitud;
    anexoMensaje?: string | null;
    /** Canal del alta AT al aceptar: URGENTE (< 24 h), LOTE o CONFIRMADA si ya tenía alta. */
    arcaCanal?: 'URGENTE' | 'LOTE' | 'CONFIRMADA' | null;
    contratoId?: string | null;
    turnoIds?: string[];
    venceAt?: any;
    vencidaAt?: any;
    /** Cupo por género: género de la persona ('M' | 'F' | '') y grupo al que aporta ('M' | 'F' | 'TODOS'). */
    genero?: string;
    cupoGrupo?: string;
    /** El servidor reservó el lugar en la transacción de aceptación. */
    cupoReservado?: boolean;
    cupoCerradoAt?: any;
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
        genero?: string;
        cupoGrupo?: string;
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
