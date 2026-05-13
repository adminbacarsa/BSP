export type RestoreMode = 'merge' | 'full';
export interface RestoreResult {
    mode: RestoreMode;
    fileName: string;
    collections: string[];
    docsRestored: number;
    docsDeleted: number;
    durationMs: number;
}
export declare function runRestore(driveFileId: string, mode: RestoreMode, jobId?: string): Promise<RestoreResult>;
