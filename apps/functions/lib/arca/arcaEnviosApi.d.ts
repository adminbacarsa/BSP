import { type EstadoEnvio } from './arcaEnviosCore';
export declare function aplicarTransicion(envioId: string, input: {
    estado: EstadoEnvio;
    origen: 'ROBOT' | 'LINK';
    nroTransaccion?: string;
    constanciaUrl?: string;
    error?: string;
    actor: string;
    marcarTokenUsado?: boolean;
}): Promise<{
    status: number;
    body: Record<string, unknown>;
}>;
export declare const arcaEnviosApi: import("firebase-functions/v2/https").HttpsFunction;
