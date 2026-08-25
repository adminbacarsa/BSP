import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
export type DigestEventType = 'TURNO_NUEVO' | 'TURNO_MODIFICADO' | 'TURNO_ELIMINADO' | 'FRANCO_ASIGNADO';
export declare function buildDigestMessage(d: {
    nuevo: number;
    modificado: number;
    eliminado: number;
    franco: number;
    samples: string[];
}): {
    title: string;
    body: string;
    type: string;
};
export declare function enqueueShiftNotifDigest(db: admin.firestore.Firestore, params: {
    employeeId: string;
    empresaId?: string | null;
    eventType: DigestEventType;
    sampleBody: string;
    turnoId: string;
}): Promise<void>;
export declare const flushShiftNotifDigests: functions.CloudFunction<unknown>;
