import { Timestamp, type Firestore } from 'firebase-admin/firestore';
export declare function runConvocadoAbsentPass(_db: Firestore, _now: Timestamp, _cc?: unknown): Promise<number>;
