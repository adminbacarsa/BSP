import { Timestamp, type Firestore } from 'firebase-admin/firestore';
export declare function convocadoFollowUpClosePatch(reason: 'FICHO' | 'HUECO_TERMINADO' | 'CANCELADA', now: Timestamp): Record<string, unknown>;
export declare function runConvocadoFollowUp(db: Firestore, now?: Timestamp): Promise<number>;
