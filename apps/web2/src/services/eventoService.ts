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

// ── Tipos ──────────────────────────────────────────────────────────────────

export type TipoTurnoEvento = '3x8' | '2x12' | 'libre';

export type EstadoServicio = 'pendiente' | 'confirmado' | 'ejecutado' | 'cancelado';

export interface UbicacionServicio {
    tipo: 'objetivo_existente' | 'nueva';
    objectiveId?: string;
    objectiveNombre?: string;
    /** Dirección textual para ubicaciones nuevas */
    direccion?: string;
    latitud?: number;
    longitud?: number;
}

export interface ServicioEvento {
    id: string;
    nombre: string;
    /** Fecha del servicio YYYY-MM-DD */
    fecha: string;
    tipoTurno: TipoTurnoEvento;
    horaInicio: string;
    horaFin: string;
    /** Total horas del servicio (24 para 3x8 y 2x12, exacto para libre) */
    horasTotal: number;
    ubicacion: UbicacionServicio;
    /** Cupo de guardias para este servicio */
    cupo: number;
    requisitos?: string;
    instrucciones?: string;
    status: EstadoServicio;
}

export interface Evento {
    id?: string;
    empresaId: string;
    nombre: string;
    descripcion?: string;
    clienteId: string;
    clienteNombre: string;
    /** Fecha más temprana — campo principal para range queries */
    fecha: string;
    /** Fechas adicionales YYYY-MM-DD[] (las restantes después de fecha) */
    fechas?: string[];
    servicios: ServicioEvento[];
    status: 'activo' | 'borrador' | 'abierto' | 'en_curso' | 'ejecutado' | 'cancelado';
    creadoPor?: string;
    creadoAt?: any;
    updatedAt?: any;
    // Campos legacy (eventos creados antes del modelo de servicios)
    horaInicio?: string;
    horaFin?: string;
    horasEvento?: number;
    cupoGuardias?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Determina si un evento debe mostrarse en cronogramas de planificación. */
export function isEventoActivo(ev: Evento): boolean {
    return (
        ev.status === 'activo' ||
        ev.status === 'abierto' ||
        ev.status === 'en_curso'
    );
}

/** Calcula horas de un servicio según su tipo de turno. */
export function calcHorasServicio(s: Pick<ServicioEvento, 'tipoTurno' | 'horaInicio' | 'horaFin'>): number {
    if (s.tipoTurno === '3x8' || s.tipoTurno === '2x12') return 24;
    return calcHorasEvento(s.horaInicio, s.horaFin);
}

/** Calcula horas a partir de strings HH:MM, cruza medianoche correctamente. */
export function calcHorasEvento(horaInicio: string, horaFin: string): number {
    const [sh, sm] = horaInicio.split(':').map(Number);
    const [eh, em] = horaFin.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    return Math.round(mins / 60);
}

/**
 * Deriva los campos fecha / fechas de un array de servicios.
 * Mantiene el contrato usado por las range queries de Firestore.
 */
export function buildFechasFromServicios(servicios: ServicioEvento[]): { fecha: string; fechas: string[] } {
    const sorted = [...new Set(servicios.map(s => s.fecha))].sort();
    const [fecha, ...fechas] = sorted;
    return { fecha: fecha ?? '', fechas };
}

/** Filtra los eventos activos que incluyen la fecha dada (principal o adicionales). */
export function eventosParaFecha(eventos: Evento[], fecha: string): Evento[] {
    return eventos.filter(ev =>
        isEventoActivo(ev) &&
        (ev.fecha === fecha || (ev.fechas || []).includes(fecha)),
    );
}

/**
 * Devuelve los pares {evento, servicio} cuyos servicios caen en la fecha dada.
 * Usa el array servicios[] si existe; fallback a eventos legacy planos.
 */
export function serviciosParaFecha(
    eventos: Evento[],
    fecha: string,
): Array<{ evento: Evento; servicio: ServicioEvento }> {
    const result: Array<{ evento: Evento; servicio: ServicioEvento }> = [];
    for (const ev of eventos) {
        if (!isEventoActivo(ev)) continue;
        const servicios = ev.servicios ?? [];
        if (servicios.length > 0) {
            servicios
                .filter(s => s.fecha === fecha && s.status !== 'cancelado')
                .forEach(s => result.push({ evento: ev, servicio: s }));
        } else if (ev.fecha === fecha || (ev.fechas || []).includes(fecha)) {
            // Evento legacy sin servicios[] — crear un servicio sintético
            result.push({
                evento: ev,
                servicio: {
                    id: ev.id || '',
                    nombre: ev.nombre,
                    fecha,
                    tipoTurno: 'libre',
                    horaInicio: ev.horaInicio ?? '08:00',
                    horaFin: ev.horaFin ?? '20:00',
                    horasTotal: ev.horasEvento ?? 8,
                    ubicacion: { tipo: 'nueva' },
                    cupo: ev.cupoGuardias ?? 0,
                    status: 'pendiente',
                },
            });
        }
    }
    return result;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export const eventoService = {
    /**
     * Carga eventos cuya fecha principal cae en el rango dado.
     * @param showAll - true: incluye borradores y cancelados (panel Servicios)
     *                  false (default): solo activo/abierto/en_curso (planificación)
     */
    getByEmpresaAndRange: async (
        empresaId: string,
        fromDate: string,
        toDate: string,
        showAll = false,
    ): Promise<Evento[]> => {
        try {
            const q = query(
                collection(db, 'eventos'),
                where('empresaId', '==', empresaId),
                where('fecha', '>=', fromDate),
                where('fecha', '<=', toDate),
                orderBy('fecha'),
            );
            const snap = await getDocsOnce(q);
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Evento));
            if (showAll) return docs;
            return docs.filter(isEventoActivo);
        } catch (e) {
            console.error('Error cargando eventos:', e);
            return [];
        }
    },

    add: async (data: Omit<Evento, 'id'>): Promise<string> => {
        const payload = stampEmpresaId(
            { ...data, creadoAt: serverTimestamp() } as Record<string, unknown>,
            data.empresaId,
        );
        const ref = await addDoc(collection(db, 'eventos'), payload);
        return ref.id;
    },

    update: async (id: string, data: Partial<Evento>): Promise<void> => {
        await updateDoc(doc(db, 'eventos', id), {
            ...data as Record<string, unknown>,
            updatedAt: serverTimestamp(),
        });
    },

    cancel: async (id: string): Promise<void> => {
        await updateDoc(doc(db, 'eventos', id), {
            status: 'cancelado',
            updatedAt: serverTimestamp(),
        });
    },
};
