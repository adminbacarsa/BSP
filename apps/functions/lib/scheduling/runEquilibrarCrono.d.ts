import * as functions from 'firebase-functions/v1';
export interface RunEquilibrarCronoInput {
    empresaId: string;
    objectiveId: string;
    year: number;
    month: number;
    dryRun?: boolean;
}
export interface RunEquilibrarCronoOutput {
    ok: boolean;
    empleadosRotados: number;
    bloquesProcesados: number;
    turnosActualizados: number;
    horasAntes: Record<string, number>;
    horasDespues: Record<string, number>;
    errores: string[];
    dryRun?: boolean;
    isPublished?: boolean;
    wasPublished?: boolean;
}
export declare const runEquilibrarCronoHandler: (data: RunEquilibrarCronoInput, context: functions.https.CallableContext) => Promise<RunEquilibrarCronoOutput>;
export declare const runEquilibrarCrono: functions.HttpsFunction & functions.Runnable<any>;
