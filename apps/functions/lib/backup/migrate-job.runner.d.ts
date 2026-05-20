export interface MigrateEmpresaRequestPayload {
    sourceEmpresaId: string;
    targetEmpresaId: string;
    jobId?: string;
}
export declare function assertMigrateEmpresaRequestAllowed(authUid: string, tokenRoleRaw: unknown, payload: MigrateEmpresaRequestPayload): Promise<{
    jobId: string;
    sourceEmpresaId: string;
    targetEmpresaId: string;
}>;
export declare function executeEmpresaMigrateJob(jobId: string): Promise<void>;
