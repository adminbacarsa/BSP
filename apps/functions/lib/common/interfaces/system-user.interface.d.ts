import * as admin from 'firebase-admin';
export type SystemRole = 'SuperAdmin' | 'Manager' | 'Scheduler' | 'Supervisor' | 'Operator';
export interface ISystemUser {
    uid: string;
    email: string;
    displayName: string;
    role: SystemRole;
    businessUnitId?: string;
    status: 'Active' | 'Inactive';
    createdAt: admin.firestore.Timestamp;
    lastLogin?: admin.firestore.Timestamp;
}
