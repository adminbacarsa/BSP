import * as admin from 'firebase-admin';
import { type ShiftDataForCascade } from './convocatoriasCobertura';
export declare function iniciarEarlyWithdrawCascade(db: admin.firestore.Firestore, shift: ShiftDataForCascade, createdBy?: string): Promise<void>;
