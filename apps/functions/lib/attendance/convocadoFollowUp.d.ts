import { Timestamp, type Firestore } from 'firebase-admin/firestore';
export declare function runConvocadoFollowUp(db: Firestore, now?: Timestamp): Promise<number>;
