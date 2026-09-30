export declare function isAltaArcaConfirmada(shift: Record<string, unknown> | null | undefined): boolean;
export declare function altaArcaPendienteAlerta(shift: Record<string, unknown>, nowMs: number): {
    tipo: 'ALTA_ARCA_PENDIENTE';
    prioridad: 'ALTA';
    contratoId: string | null;
    minutosAlInicio: number;
} | null;
