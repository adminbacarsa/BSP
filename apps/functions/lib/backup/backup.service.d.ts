export interface BackupOptions {
    empresaId?: string;
    scopeEmpresa?: boolean;
    source?: string;
}
export interface BackupResult {
    id: string;
    driveFileId: string;
    driveLink: string;
    fileName: string;
    sizeBytes: number;
    collections: string[];
    totalDocs: number;
    createdAt: string;
    status: 'ok' | 'error';
    error?: string;
    empresaId?: string;
}
export declare function runBackup(folderId: string, opts?: BackupOptions): Promise<BackupResult>;
export interface SyncDriveBackupsResult {
    checked: number;
    removed: number;
    kept: number;
    removedIds: string[];
}
export declare function syncDriveBackups(opts?: {
    empresaId?: string;
    scopeEmpresa?: boolean;
}): Promise<SyncDriveBackupsResult>;
export declare function deleteDriveBackup(docId: string, opts?: {
    empresaId?: string;
    scopeEmpresa?: boolean;
    isSuper?: boolean;
}): Promise<{
    deleted: boolean;
    driveDeleted: boolean;
}>;
export declare function resolveDriveBackupFolderId(): Promise<string | null>;
