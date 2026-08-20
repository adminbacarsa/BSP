export type EasGraphqlError = {
    message: string;
};
export declare function resolveEasAppId(accessToken: string, fullName: string, projectIdHint?: string): Promise<{
    appId: string;
    fullName: string;
}>;
export type EasEnvVarInput = {
    name: string;
    value: string;
    environments: ('PREVIEW' | 'PRODUCTION' | 'DEVELOPMENT')[];
    visibility: 'PUBLIC' | 'SENSITIVE' | 'SECRET';
    type: 'STRING';
};
export declare function bulkUpsertEasEnvForApp(accessToken: string, appId: string, variables: EasEnvVarInput[]): Promise<{
    created: number;
    updated: number;
}>;
export declare function fetchEasBuildById(accessToken: string, buildId: string): Promise<{
    id: string;
    status: string;
    artifacts?: {
        buildUrl?: string | null;
    } | null;
} | null>;
export declare function dispatchGithubEasWorkflow(input: {
    githubToken: string;
    repo: string;
    ref?: string;
}): Promise<void>;
