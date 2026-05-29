import { Timestamp } from 'firebase/firestore';

// Bandas de turno válidas para ajustes
export type BandaOcho = 'M' | 'T' | 'N';
export type BandaDoce = 'D12' | 'N12';
export type BandaAjuste = BandaOcho | BandaDoce | 'RET';

// Estrategia usada en ajustes por ausencia
export type EstrategiaCobertura = 'COMPRIMIR_12H' | 'RETEN_EXTERNO' | 'VACANTE';

// Estado del ajuste general
export type EstadoAjuste = 'ACTIVO' | 'REVERTIDO';

// Estado del retén individual dentro del ajuste
export type EstadoReten = 'DISPONIBLE' | 'ASIGNADO';

// Estado de cobertura en el documento de ausencia (campo externo)
export type EstadoCobertura = 'PENDIENTE' | 'GESTIONADA' | 'VACANTE';

// ─────────────────────────────────────────────
// Sub-interfaces reutilizadas en AjusteCrono
// ─────────────────────────────────────────────

export interface CambioBanda {
    employeeId: string;
    employeeName: string;
    bandaAnterior: BandaOcho;
    bandaNueva: BandaDoce;
    turnoIds: string[];       // IDs de los turnos actualizados en Firestore
}

export interface RetenAjuste {
    employeeId: string;
    employeeName: string;
    turnoOrigenIds: string[];
    destinoObjetivoId?: string;
    destinoObjetivoNombre?: string;
    destinoTurnoIds?: string[];   // turnos RETEN creados en el objetivo destino
    estado: EstadoReten;
}

// ─────────────────────────────────────────────
// Documento principal: ajustes_crono
// ─────────────────────────────────────────────

export interface AjusteCrono {
    id: string;
    empresaId: string;

    /**
     * OPERATIVO     — un solo día (fechaInicio === fechaFin).
     *                 Usado para eventos, refuerzos puntuales.
     * COBERTURA_AUSENCIA — rango de días que dura la ausencia del guardia.
     */
    tipo: 'OPERATIVO' | 'COBERTURA_AUSENCIA';

    fechaInicio: Timestamp;
    fechaFin: Timestamp;

    origenObjetivoId: string;
    origenObjetivoNombre: string;

    motivo: string;

    cambiosBanda: CambioBanda[];
    retenes: RetenAjuste[];

    // Solo para COBERTURA_AUSENCIA
    guardiaAusenteId?: string;
    guardiaAusenteNombre?: string;
    ausenciaId?: string;
    estrategiaCobertura?: EstrategiaCobertura;

    creadoPor: string;
    createdAt: Timestamp;
    estado: EstadoAjuste;
}

// ─────────────────────────────────────────────
// Tipo de entrada para crear un ajuste (sin id/createdAt)
// ─────────────────────────────────────────────

export type AjusteCronoInput = Omit<AjusteCrono, 'id' | 'createdAt'>;

// ─────────────────────────────────────────────
// Props compartidas entre los dos modales
// ─────────────────────────────────────────────

export interface AjustarCronoOperativoProps {
    open: boolean;
    onClose: () => void;
    empresaId: string;
    /** Fecha pre-cargada si se abre desde el grid de planificación */
    fechaInicial?: Date;
    /** Fin de rango pre-cargado (ej. fin de mes visible) */
    fechaHastaInicial?: Date;
    /** Objetivo pre-cargado si se abre desde la fila de un servicio */
    objetivoInicial?: { id: string; nombre: string };
    /** Misma fuente que la grilla — preview coherente con lo visible */
    gridSnapshot?: {
        shiftsMap: Record<string, any>;
        pendingChanges: Record<string, any>;
    };
}

export interface AjustarCronoCoberturaProps {
    open: boolean;
    onClose: () => void;
    empresaId: string;
    ausencia: {
        id: string;
        employeeId: string;
        employeeName: string;
        startDate: Date;
        endDate: Date;
        tipo: 'VACACIONES' | 'LICENCIA' | 'AUSENCIA' | 'ENFERMEDAD';
    };
}

// ─────────────────────────────────────────────
// Extensión del documento ausencias (campos nuevos)
// ─────────────────────────────────────────────

export interface AusenciaConCobertura {
    ajusteCronoId?: string;
    coberturaEstado?: EstadoCobertura;
}

// ─────────────────────────────────────────────
// Estado local de UI para el modal operativo
// ─────────────────────────────────────────────

export interface FilaGuardiaAjuste {
    employeeId: string;
    employeeName: string;
    turnoId: string;
    bandaOriginal: BandaOcho;
    bandaAjuste: BandaAjuste;
    destinoObjetivoId?: string;
    destinoObjetivoNombre?: string;
}

// Resultado de validación del ajuste antes de guardar
export interface ValidacionAjuste {
    valido: boolean;
    errores: string[];
    tieneD12: boolean;
    tieneN12: boolean;
    retenes: FilaGuardiaAjuste[];
    cambios: FilaGuardiaAjuste[];
}
