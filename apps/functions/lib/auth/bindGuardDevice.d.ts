import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
export type BindGuardDeviceSource = 'email_link' | 'approval';
export type GuardDeviceBindErrorCode = 'DEVICE_OWNED_BY_OTHER' | 'RETIRED_DEVICE_NEEDS_EMAIL' | 'DEVICE_ID_REQUIRED';
export declare class GuardDeviceBindError extends Error {
    readonly code: GuardDeviceBindErrorCode;
    constructor(code: GuardDeviceBindErrorCode, message: string);
}
export declare function guardDeviceBindErrorToHttps(err: GuardDeviceBindError): functions.https.HttpsError;
export declare function rethrowBindGuardDeviceError(err: unknown): never;
export declare function assertCanRequestGuardDeviceRegistration(db: admin.firestore.Firestore, uid: string, deviceId: string): Promise<void>;
export interface BindGuardDeviceParams {
    uid: string;
    employeeId: string;
    empresaId?: string | null;
    deviceId: string;
    source: BindGuardDeviceSource;
    deviceInfo?: Record<string, string>;
    platform?: string;
    tokenExtras?: Record<string, unknown>;
}
export declare function bindGuardDevice(db: admin.firestore.Firestore, params: BindGuardDeviceParams): Promise<void>;
export declare function unbindGuardDeviceForUid(db: admin.firestore.Firestore, targetUid: string, unboundBy?: string): Promise<{
    hadDeviceId: string | null;
}>;
