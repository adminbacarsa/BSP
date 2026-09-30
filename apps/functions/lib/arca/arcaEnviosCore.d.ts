export declare const ESTADOS_ENVIO: readonly ["PENDIENTE", "SUBIENDO", "CONFIRMADO", "ERROR", "MANUAL"];
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];
export type OrigenEnvio = 'ROBOT' | 'MANUAL' | 'LINK';
export declare const TOKEN_VIGENCIA_MS: number;
export declare const ALERTA_ALTA_PENDIENTE_MS: number;
export type EnvioDoc = {
    estado?: EstadoEnvio;
    origen?: OrigenEnvio | null;
    tipo?: 'AT' | 'BT';
    txt?: string;
    intentos?: unknown[];
    token?: string | null;
    tokenExpiraAt?: string | null;
    tokenUsadoAt?: string | null;
    constanciaUrl?: string | null;
    empresaNombre?: string;
    fechaAlta?: string | null;
    fechaBaja?: string | null;
    advertencias?: string[];
};
export type ResultadoTransicion = {
    ok: boolean;
    codigo?: string;
    patch?: Record<string, unknown>;
};
export type ResultadoToken = {
    ok: boolean;
    codigo?: string;
};
export declare function transicionEnvio(envio: EnvioDoc, input: {
    estado: EstadoEnvio;
    origen?: OrigenEnvio;
    nroTransaccion?: string;
    constanciaUrl?: string | null;
    error?: string | null;
    actor?: string | null;
    at?: string;
}): ResultadoTransicion;
export declare function validarToken(envio: EnvioDoc | null, token: string, nowMs: number): ResultadoToken;
export declare function vistaPublicaEnvio(envio: EnvioDoc): Record<string, unknown>;
export declare function nuevoToken(nowMs: number): {
    token: string;
    tokenExpiraAt: string;
    tokenUsadoAt: null;
};
export declare function rateLimitHit(clave: string, nowMs: number, max?: number, ventanaMs?: number): boolean;
