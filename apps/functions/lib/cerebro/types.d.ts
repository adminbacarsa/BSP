export interface CerebroShift {
    code: string;
    name: string;
    hours: number;
    startTime: string;
    endTime: string;
    days?: string[];
    specificDates?: string[];
}
export interface CerebroPosition {
    id: string;
    name: string;
    coverageType: '24hs' | '12hs_diurno' | '12hs_nocturno' | 'custom';
    quantity: number;
    shifts: CerebroShift[];
    activeDays: string[];
    excludedDates?: string[];
    operaFeriados?: boolean;
}
export interface CerebroSLA {
    id: string;
    objectiveId: string;
    objectiveName?: string;
    clientId: string;
    positions: CerebroPosition[];
    startDate: string;
    endDate: string;
    totalMonthlyHours?: number;
    excludedDates?: string[];
}
export interface CoverageNeed {
    puestoId: string;
    puestoName: string;
    banda: string;
    bandaName: string;
    cantSimultaneos: number;
    diasSemana: string[];
    horaInicio: string;
    horaFin: string;
    hours: number;
    esBanda12h: boolean;
    excludedDates: string[];
}
export interface MasaCritica {
    banda: string;
    cantSimultaneos: number;
    empleadosMinimos: number;
    ciclo: {
        diasTrabajo: number;
        cicloDias: number;
    };
    empleadosActuales?: number;
    enDeficit: boolean;
    faltante?: number;
}
export interface EstadoServicio {
    esNuevo: boolean;
    turnosExistentes: number;
    empleadosAsignados: string[];
    posicionesCubiertas: string[];
    ultimaFechaGeneracion?: string;
}
export interface BandaEspecialInfo {
    esBanda12h: boolean;
    bandas12h: string[];
    cicloAdaptado: {
        diasTrabajo: number;
        cicloDias: number;
    };
    maxDiasConsecutivos: number;
    notas: string[];
}
export interface CoberturaFeriado {
    fecha: string;
    nombreFeriado: string;
    requiereCobertura: boolean;
    tipoCodigo: 'FF' | 'normal';
    esFeriadoNacional: boolean;
    esFeriadoProvincial: boolean;
}
export declare const DIAS_SEMANA: readonly ["L", "M", "X", "J", "V", "S", "D"];
export type DiaSemana = typeof DIAS_SEMANA[number];
export declare const BANDAS_8H: readonly ["M", "T", "N", "ESC", "REF", "RET"];
export declare const BANDAS_12H: readonly ["D12", "N12"];
export declare const CICLO_ESTANDAR: {
    readonly diasTrabajo: 6;
    readonly cicloDias: 8;
};
export declare const CICLO_12H: {
    readonly diasTrabajo: 4;
    readonly cicloDias: 6;
};
export declare const HORARIOS_BANDA: Record<string, {
    startTime: string;
    endTime: string;
    hours: number;
    name: string;
}>;
export declare function normalizarSlaDeFirestore(doc: Record<string, any>): CerebroSLA;
