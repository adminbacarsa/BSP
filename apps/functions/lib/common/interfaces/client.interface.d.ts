import * as admin from 'firebase-admin';
export interface IClient {
    id: string;
    businessName: string;
    cuit: string;
    contactName: string;
    contactEmail: string;
    status: 'Active' | 'Inactive' | 'Suspended';
    createdAt: admin.firestore.Timestamp;
}
export interface IObjective {
    id: string;
    clientId: string;
    name: string;
    address: string;
    location: {
        latitude: number;
        longitude: number;
    };
    zones?: string[];
}
export interface IServiceContract {
    id: string;
    objectiveId: string;
    name: string;
    startDate: admin.firestore.Timestamp;
    endDate?: admin.firestore.Timestamp;
    totalHoursPerMonth: number;
    isActive: boolean;
}
export interface IShiftType {
    id: string;
    contractId: string;
    name: string;
    code: string;
    color: string;
    startTime: string;
    durationHours: number;
    requiredRole?: string;
}
