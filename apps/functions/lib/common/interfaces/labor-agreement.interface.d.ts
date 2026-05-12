import * as admin from 'firebase-admin';
export interface ILaborAgreement {
    id: string;
    name: string;
    code: string;
    maxHoursWeekly: number;
    maxHoursMonthly: number;
    saturdayCutoffHour: number;
    nightShiftStart: number;
    nightShiftEnd: number;
    isActive: boolean;
    createdAt?: admin.firestore.Timestamp;
}
