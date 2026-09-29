import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { loadCentroControlState } from '../ops/centroControlGuard';
type CcState = Awaited<ReturnType<typeof loadCentroControlState>>;
export declare function runShiftArrivalNotices(db: Firestore, now: Timestamp, cc: CcState): Promise<number>;
export {};
