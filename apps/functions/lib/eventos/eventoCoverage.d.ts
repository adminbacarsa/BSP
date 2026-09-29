export declare const EVENT_COVERAGE_CASCADE_ORDER: readonly ["REF", "ESC", "EXTEND", "ADVANCE", "FT"];
export type EventualCandidato = {
    employeeId: string;
    employeeName: string;
};
export declare function isEventoShift(shift: object | null | undefined): boolean;
export declare function eventoTieneFranjasEncadenadas(shift: object | null | undefined): boolean;
export declare function eventualesParaHueco(): EventualCandidato[];
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
