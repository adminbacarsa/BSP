import { type Firestore } from 'firebase-admin/firestore';
export declare function applyAutoRetentionForAbsenceShift(db: Firestore, absenceShiftId: string, absenceData: Record<string, unknown>): Promise<{
    applied: boolean;
    shiftId?: string;
    employeeName?: string;
}>;
