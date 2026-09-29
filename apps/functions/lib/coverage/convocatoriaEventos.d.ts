import { type Firestore } from 'firebase-admin/firestore';
export type ConvocatoriaEvento = {
    type: 'CREADA' | 'PUSH' | 'RESPUESTA' | 'RESULTADO';
    at?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
    origin?: 'AUTO' | 'CC' | 'DEMO';
    createdBy?: string;
    tokenSuffix?: string;
    result?: 'sent' | 'failed' | 'no_token';
    errorCode?: string;
    response?: 'ACCEPTED' | 'REJECTED' | 'TIMEOUT';
    channel?: string;
    deviceId?: string;
    platform?: string;
    appVersion?: string;
    outcome?: 'aplicada' | 'revalidacion_rechazada' | 'cancelada';
    reason?: string;
};
export declare function canalOrigenConvocatoria(createdBy: unknown): 'AUTO' | 'CC' | 'DEMO';
export declare function logConvocatoriaEvento(db: Firestore, convocatoriaId: string, event: ConvocatoriaEvento): Promise<void>;
