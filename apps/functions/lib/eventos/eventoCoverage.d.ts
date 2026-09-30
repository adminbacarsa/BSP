export declare const EVENT_COVERAGE_CASCADE_ORDER: readonly ["EVENTUAL", "REF", "ESC", "EXTEND", "ADVANCE", "FT"];
export declare const OBJECTIVE_COVERAGE_WITH_EVENTUAL: readonly ["RET", "REF", "ESC", "EVENTUAL", "EXTEND", "ADVANCE", "FT"];
export type EventualCandidato = {
    employeeId: string;
    employeeName: string;
    cuil: string;
    uid?: string;
    distanceKm: number | null;
    confiabilidad: number;
};
export type EventualBolsaRow = {
    cuil: string;
    nombre?: string;
    disponibilidad?: string;
    empresasHabilitadas?: string[];
    credencialVencimiento?: string;
    aptoPsicofisico?: {
        estado?: string;
        vencimiento?: string;
    };
    domicilioGeo?: {
        lat?: number;
        lng?: number;
    } | null;
    confiabilidad?: number;
    uid?: string;
    legajos?: {
        employeeId?: string;
        empresaId?: string;
    }[];
};
export type EventualHueco = {
    empresaId: string;
    startMs: number;
    endMs: number;
    lat?: number | null;
    lng?: number | null;
    hoyYmd: string;
};
export type EventualJornadaOcupada = {
    cuil: string;
    empresaId?: string;
    startMs: number;
    endMs: number;
};
export type EventualesHuecoInput = {
    bolsa?: EventualBolsaRow[];
    hueco?: EventualHueco;
    otrasJornadas?: EventualJornadaOcupada[];
};
export declare function isEventoShift(shift: object | null | undefined): boolean;
export declare function eventoTieneFranjasEncadenadas(shift: object | null | undefined): boolean;
export declare function bloqueoCruceEventual(nueva: {
    empresaId: string;
    startMs: number;
    endMs: number;
}, otras: {
    empresaId?: string;
    startMs: number;
    endMs: number;
}[]): {
    ok: boolean;
    codigo?: 'SUPERPOSICION' | 'DESCANSO_12H';
};
export declare function eventualesParaHueco(input?: EventualesHuecoInput | null): EventualCandidato[];
export type EventualAusentePlan = {
    employeeId: string;
    empresaAltaId: string;
    eventoId: string;
    shiftId: string;
    neverStarted: boolean;
    descuentaLiquidacion: true;
    confiabilidadDelta: -1;
    arcaBajaPendiente: boolean;
};
export declare function planEventualAusente(input: {
    employeeId?: string;
    empresaAltaId?: string;
    eventoId?: string;
    shiftId?: string;
    isEventual?: boolean;
    punched?: boolean;
}): EventualAusentePlan | null;
