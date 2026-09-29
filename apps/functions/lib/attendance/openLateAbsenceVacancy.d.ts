import { type Firestore } from 'firebase-admin/firestore';
export declare function openLateAbsenceVacancy(db: Firestore, shiftId: string): Promise<boolean>;
