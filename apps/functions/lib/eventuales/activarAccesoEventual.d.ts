import * as admin from 'firebase-admin';
type ActivateInput = {
    token: string;
    password: string;
    deviceId?: string;
    deviceInfo?: Record<string, string>;
    platform?: 'web' | 'ios' | 'android';
};
export declare function esActivacionEventual(td: {
    tipo?: unknown;
    employeeId?: unknown;
    bolsaCuil?: unknown;
}): boolean;
export declare function activarAccesoEventual(db: admin.firestore.Firestore, input: {
    td: Record<string, unknown>;
    tokenRef: admin.firestore.DocumentReference;
    password: string;
    deviceId: string;
    deviceInfo?: Record<string, string>;
    platform?: string;
}): Promise<{
    email: string;
    employeeId: string;
    bolsaCuil: string;
}>;
export declare function activateAndSetPasswordHandler(data: ActivateInput): Promise<{
    email: string;
    employeeId: string;
    bolsaCuil?: string;
}>;
export {};
