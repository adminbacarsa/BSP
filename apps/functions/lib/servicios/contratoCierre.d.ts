import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
export declare function cerrarContratosVencidos(db: admin.firestore.Firestore, opts?: {
    dryRun?: boolean;
    empresaId?: string | null;
}): Promise<{
    closed: number;
    ids: string[];
}>;
export declare const scheduledCerrarContratosVencidos: import("firebase-functions/v2/scheduler").ScheduleFunction;
export declare const reabrirContratoSla: functions.HttpsFunction & functions.Runnable<any>;
export declare const cerrarContratoSla: functions.HttpsFunction & functions.Runnable<any>;
