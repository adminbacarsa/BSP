import { Timestamp, type Firestore } from 'firebase-admin/firestore';
export declare function runConvocadoAbsentPass(db: Firestore, now: Timestamp): Promise<number>;
