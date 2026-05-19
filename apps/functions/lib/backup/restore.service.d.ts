export type RestoreMode = 'merge' | 'full';
export interface RestoreResult {
    mode: RestoreMode;
    fileName: string;
    collections: string[];
    docsRestored: number;
    docsDeleted: number;
    durationMs: number;
    isComplete?: boolean;
    nextColIndex?: number;
    totalCollections?: number;
    idMaps?: IdMaps;
}
export interface RestorePartialState {
    startColIndex?: number;
    collectionsPerRun?: number;
    idMaps?: IdMaps;
    docsRestored?: number;
    docsDeleted?: number;
}
export declare function serializeIdMaps(idMaps: IdMaps): Record<string, Record<string, string>>;
export declare function deserializeIdMaps(raw: unknown): IdMaps;
export declare function downloadBackupPayloadFromStorage(storagePath: string): Promise<Record<string, unknown>>;
export declare function deleteBackupStorageFile(storagePath: string): Promise<void>;
export interface RestoreOptions {
    empresaId?: string;
    scopeEmpresa?: boolean;
    tenantImport?: boolean;
    sourceEmpresaId?: string;
}
type IdMaps = Record<string, Map<string, string>>;
export declare function runRestoreFromPayload(payload: Record<string, unknown>, fileName: string, mode: RestoreMode, jobId?: string, opts?: RestoreOptions, partial?: RestorePartialState): Promise<RestoreResult>;
export declare function runRestore(driveFileId: string, mode: RestoreMode, jobId?: string, opts?: RestoreOptions, partial?: RestorePartialState): Promise<RestoreResult>;
export declare function runRestoreFromStorage(storagePath: string, fileName: string, mode: RestoreMode, jobId?: string, opts?: RestoreOptions, partial?: RestorePartialState): Promise<RestoreResult>;
export {};
