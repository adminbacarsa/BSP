import * as admin from 'firebase-admin';
export interface IShift {
    id: string;
    employeeId: string;
    employeeName: string;
    objectiveId: string;
    objectiveName: string;
    startTime: admin.firestore.Timestamp;
    endTime: admin.firestore.Timestamp;
    status: 'Assigned' | 'Confirmed' | 'InProgress' | 'Completed' | 'Canceled';
    checkInTime?: admin.firestore.Timestamp;
    checkOutTime?: admin.firestore.Timestamp;
    schedulerId: string;
    updatedAt: admin.firestore.Timestamp;
    role?: string;
    isOvertime?: boolean;
}
