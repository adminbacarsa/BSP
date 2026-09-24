import { type Firestore } from 'firebase-admin/firestore';
export declare function cancelLlegadaTardeConvocatorias(db: Firestore, shiftId: string, reason: 'CHECKED_IN' | 'LATE_NOTICE'): Promise<number>;
