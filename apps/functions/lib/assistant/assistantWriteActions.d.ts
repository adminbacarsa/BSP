export type AgentActionPayload = Record<string, unknown>;
export declare function ejecutarExtenderJornada(empresaId: string, payload: AgentActionPayload): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function ejecutarCubrirAusencia(empresaId: string, payload: AgentActionPayload): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function ejecutarCrearTurnoRefuerzo(empresaId: string, payload: AgentActionPayload): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function ejecutarConfirmarPresencia(empresaId: string, payload: AgentActionPayload): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function ejecutarRegistrarAusencia(empresaId: string, payload: AgentActionPayload): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function ejecutarCerrarTurno(empresaId: string, payload: AgentActionPayload): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function ejecutarPlanificarObjetivoMes(empresaId: string, payload: AgentActionPayload): Promise<{
    ok: boolean;
    message: string;
}>;
