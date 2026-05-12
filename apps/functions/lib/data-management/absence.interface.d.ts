import * as admin from 'firebase-admin';
export interface IAbsence {
    id: string;
    employeeId: string;
    employeeName: string;
    clientId: string;
    type: 'VACATION' | 'SICK_LEAVE' | 'OTHER';
    startDate: admin.firestore.Timestamp;
    endDate: admin.firestore.Timestamp;
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    createdAt: admin.firestore.Timestamp;
}
export interface IAbsencePayload {
    employeeId: string;
    employeeName: string;
    clientId: string;
    type: 'VACATION' | 'SICK_LEAVE' | 'OTHER';
    startDate: admin.firestore.Timestamp | Date;
    endDate: admin.firestore.Timestamp | Date;
    reason: string;
}
