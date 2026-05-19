import { RestoreMode, RestoreOptions } from './restore.service';
export interface RestoreRequestPayload {
    driveFileId?: string;
    storagePath?: string;
    fileName?: string;
    mode: RestoreMode;
    jobId?: string;
    empresaId?: string;
    tenantImport?: boolean;
    sourceEmpresaId?: string;
}
export declare function assertRestoreRequestAllowed(authUid: string, tokenRoleRaw: unknown, payload: RestoreRequestPayload): Promise<{
    jobId: string;
    restoreOpts: RestoreOptions;
    fileName: string;
}>;
export declare function executeRestoreJob(jobId: string): Promise<void>;
