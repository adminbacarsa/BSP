import type { Firestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
export type SesionOperadorAction = 'start' | 'end' | 'requestPilot' | 'cancelPilotRequest' | 'acceptPilot' | 'rejectPilot' | 'passToAuto';
export type WriteOrigin = 'WEB' | 'MOBILE';
export type SesionOperadorRequest = {
    action: SesionOperadorAction;
    empresaId: string;
    writeOrigin?: WriteOrigin;
};
export declare function handleSesionOperador(db: Firestore, uid: string, data: SesionOperadorRequest, tokenRole?: unknown): Promise<{
    success: true;
    action: SesionOperadorAction;
}>;
export declare const sesionOperadorCallable: functions.HttpsFunction & functions.Runnable<any>;
