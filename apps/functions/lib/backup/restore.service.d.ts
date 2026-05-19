export type RestoreMode = 'merge' | 'full';
export interface RestoreResult {
    mode: RestoreMode;
    fileName: string;
    collections: string[];
    docsRestored: number;
    docsDeleted: number;
    durationMs: number;
}
export interface RestoreOptions {
    empresaId?: string;
    scopeEmpresa?: boolean;
    tenantImport?: boolean;
    sourceEmpresaId?: string;
}
export declare function runRestoreFromPayload(payload: Record<string, unknown>, fileName: string, mode: RestoreMode, jobId?: string, opts?: RestoreOptions): Promise<RestoreResult>;
export declare function runRestore(driveFileId: string, mode: RestoreMode, jobId?: string, opts?: RestoreOptions): Promise<RestoreResult>;
export declare function runRestoreFromStorage(storagePath: string, fileName: string, mode: RestoreMode, jobId?: string, opts?: RestoreOptions): Promise<RestoreResult>;
