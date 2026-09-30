import * as functions from 'firebase-functions/v1';
export declare function acusarReciboContratoHandler(data: {
    contratoId?: unknown;
    dispositivo?: unknown;
    deviceId?: unknown;
}, context: functions.https.CallableContext): Promise<{
    ok: true;
    already?: boolean;
    pdfHash: string | null;
}>;
export declare const acusarReciboContrato: functions.HttpsFunction & functions.Runnable<any>;
