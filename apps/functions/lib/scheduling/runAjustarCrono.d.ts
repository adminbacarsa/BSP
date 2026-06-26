import * as functions from 'firebase-functions/v1';
export interface RunAjustarCronoInput {
    empresaId: string;
    objectiveId: string;
    objectiveNombre?: string;
    fechaDesde: string;
    fechaHasta: string;
    motivo?: string;
    destinoObjetivoId?: string;
    destinoObjetivoNombre?: string;
}
export interface RunAjustarCronoOutput {
    ok: boolean;
    retenesLiberados: number;
    slotsAplicados: number;
    slotsOmitidos: number;
    errores: string[];
}
export declare const runAjustarCronoHandler: (data: RunAjustarCronoInput, context: functions.https.CallableContext) => Promise<RunAjustarCronoOutput>;
export declare const runAjustarCrono: functions.HttpsFunction & functions.Runnable<any>;
