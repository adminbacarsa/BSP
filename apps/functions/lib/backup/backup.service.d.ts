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
}
export declare function runBackup(folderId: string): Promise<BackupResult>;
