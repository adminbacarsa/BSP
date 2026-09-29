import type * as admin from 'firebase-admin';
export declare const SHIFT_ALERT_CHANNEL_ID = "alertas_turno";
export declare const SHIFT_ALERT_FCM_TYPES: Set<string>;
export declare function isShiftAlertFcmType(type: string): boolean;
export declare function shiftAlertPlatformConfig(): {
    android: admin.messaging.AndroidConfig;
    apns: admin.messaging.ApnsConfig;
};
