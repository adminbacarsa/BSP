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
export declare function resolveDriveBackupFolderId(): Promise<string | null>;
