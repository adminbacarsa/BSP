import { Timestamp, type Firestore } from 'firebase-admin/firestore';
export type OriginCoords = {
    lat?: number;
    lng?: number;
    accuracy?: number;
};
export declare function recordConvocadoAcceptEta(db: Firestore, convocatoriaId: string, opts?: {
    originCoords?: OriginCoords | null;
    now?: Timestamp;
}): Promise<{
    etaMinutes: number;
    originSource: 'DEVICE' | 'DOMICILIO' | 'SIN_COORD';
}>;
export declare function responderRecordatorioConvocadoShift(db: Firestore, input: {
    convocatoriaId: string;
    action: 'ON_WAY' | 'PROBLEM';
    etaMinutes?: number;
    note?: string;
    operatorUid?: string;
}): Promise<{
    success: boolean;
    reason?: string;
}>;
