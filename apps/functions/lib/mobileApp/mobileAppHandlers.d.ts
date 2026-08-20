import * as functions from 'firebase-functions/v1';
export declare function getMobileAppConfigHandler(_data: unknown, context: functions.https.CallableContext): Promise<{
    ok: boolean;
    config: import("./mobileAppStore").MobileAppPublicConfig;
}>;
export declare function saveMobileAppConfigHandler(data: {
    expoAccountOwner?: string;
    expoProjectSlug?: string;
    expoProjectId?: string;
    portalWebOrigin?: string;
    githubRepo?: string;
    expoAccessToken?: string;
}, context: functions.https.CallableContext): Promise<{
    ok: boolean;
    config: import("./mobileAppStore").MobileAppPublicConfig;
}>;
export declare function syncMobileAppEasEnvHandler(data: {
    firebase?: {
        apiKey?: string;
        authDomain?: string;
        projectId?: string;
        storageBucket?: string;
        messagingSenderId?: string;
        appId?: string;
    };
    portalWebOrigin?: string;
}, context: functions.https.CallableContext): Promise<{
    ok: boolean;
    summary: string;
    appId: string;
    fullName: string;
}>;
export declare function triggerMobileAppPreviewBuildHandler(_data: unknown, context: functions.https.CallableContext): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function refreshMobileAppBuildStatusHandler(_data: unknown, context: functions.https.CallableContext): Promise<{
    ok: boolean;
    config: import("./mobileAppStore").MobileAppPublicConfig;
    message: string;
    build?: undefined;
} | {
    ok: boolean;
    config: import("./mobileAppStore").MobileAppPublicConfig;
    build: {
        id: string;
        status: string;
        artifacts?: {
            buildUrl?: string | null;
        } | null;
    };
    message?: undefined;
}>;
