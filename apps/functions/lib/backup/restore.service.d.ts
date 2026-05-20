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
export declare const RESTORE_COLLECTION_ORDER: string[];
type IdMaps = Record<string, Map<string, string>>;
export declare function allocateCloneDocId(db: FirebaseFirestore.Firestore, colName: string, oldId: string, idMaps: IdMaps): string;
export declare function remapCloneDocumentFields(colName: string, data: Record<string, unknown>, idMaps: IdMaps, db: FirebaseFirestore.Firestore): Record<string, unknown>;
export declare function deleteDocsWhereEmpresaId(db: FirebaseFirestore.Firestore, colName: string, empresaId: string, batchSize: number): Promise<number>;
export declare function runRestoreFromPayload(payload: Record<string, unknown>, fileName: string, mode: RestoreMode, jobId?: string, opts?: RestoreOptions, partial?: RestorePartialState): Promise<RestoreResult>;
export declare function runRestore(driveFileId: string, mode: RestoreMode, jobId?: string, opts?: RestoreOptions, partial?: RestorePartialState): Promise<RestoreResult>;
export declare function runRestoreFromStorage(storagePath: string, fileName: string, mode: RestoreMode, jobId?: string, opts?: RestoreOptions, partial?: RestorePartialState): Promise<RestoreResult>;
export {};
