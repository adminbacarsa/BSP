import * as admin from 'firebase-admin';
export interface IServicePattern {
    id: string;
    contractId: string;
    shiftTypeId: string;
    daysOfWeek: number[];
    quantityPerDay: number;
    validFrom: admin.firestore.Timestamp;
    validTo?: admin.firestore.Timestamp;
    createdAt: admin.firestore.Timestamp;
    createdBy: string;
    active: boolean;
}
export interface IPatternPayload {
    contractId: string;
    shiftTypeId: string;
    daysOfWeek: number[];
    quantity: number;
    validFrom: string;
    validTo?: string;
}
