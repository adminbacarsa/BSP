export type MobileAppPublicConfig = {
    expoAccountOwner: string;
    expoProjectSlug: string;
    expoProjectId: string;
    portalWebOrigin: string;
    githubRepo: string;
    hasExpoToken: boolean;
    expoTokenHint: string;
    lastEnvSyncAt: string | null;
    lastEnvSyncBy: string | null;
    lastEnvSyncSummary: string | null;
    lastBuildId: string | null;
    lastBuildStatus: string | null;
    lastBuildUrl: string | null;
    lastBuildAt: string | null;
    lastBuildTrigger: string | null;
    updatedAt: string | null;
};
export declare function getMobileAppPublicConfig(): Promise<MobileAppPublicConfig>;
export declare function saveMobileAppSettings(input: {
    expoAccountOwner: string;
    expoProjectSlug: string;
    expoProjectId?: string;
    portalWebOrigin: string;
    githubRepo: string;
    expoAccessToken?: string;
    updatedBy: string;
}): Promise<MobileAppPublicConfig>;
export declare function readExpoAccessToken(): Promise<string>;
export declare function patchMobileAppBuildState(input: {
    lastBuildId?: string | null;
    lastBuildStatus?: string | null;
    lastBuildUrl?: string | null;
    lastBuildAt?: string | null;
    lastBuildTrigger?: string | null;
}): Promise<void>;
export declare function patchMobileAppEnvSync(input: {
    lastEnvSyncAt: string;
    lastEnvSyncBy: string;
    lastEnvSyncSummary: string;
}): Promise<void>;
export declare function buildEasEnvPayload(firebase: Record<string, string>, portalOrigin: string): {
    name: string;
    value: string;
    environments: ("PREVIEW" | "PRODUCTION")[];
    visibility: "PUBLIC";
    type: "STRING";
}[];
