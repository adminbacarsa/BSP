import * as functions from 'firebase-functions/v1';
export declare const getSwapPeople: functions.HttpsFunction & functions.Runnable<any>;
export declare const getSwapCandidates: functions.HttpsFunction & functions.Runnable<any>;
export declare const createSwapRequest: functions.HttpsFunction & functions.Runnable<any>;
export declare const respondSwapRequest: functions.HttpsFunction & functions.Runnable<any>;
export declare const confirmSwapRequest: functions.HttpsFunction & functions.Runnable<any>;
export declare const cancelSwapRequest: functions.HttpsFunction & functions.Runnable<any>;
export declare const approveSwapRequest: functions.HttpsFunction & functions.Runnable<any>;
export declare const rejectSwapRequestSupervisor: functions.HttpsFunction & functions.Runnable<any>;
