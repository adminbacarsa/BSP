import { serializeIdMaps, deserializeIdMaps } from './restore.service';
export interface EmpresaMigrateResult {
    sourceEmpresaId: string;
    targetEmpresaId: string;
    collections: string[];
    docsCopied: number;
    docsDeleted: number;
    durationMs: number;
    isComplete?: boolean;
    nextColIndex?: number;
    totalCollections?: number;
    idMaps?: Record<string, Map<string, string>>;
}
export interface EmpresaMigratePartialState {
    startColIndex?: number;
    collectionsPerRun?: number;
    idMaps?: Record<string, Map<string, string>>;
    docsCopied?: number;
    docsDeleted?: number;
}
export declare function runEmpresaMigrate(sourceEmpresaId: string, targetEmpresaId: string, jobId?: string, partial?: EmpresaMigratePartialState): Promise<EmpresaMigrateResult>;
export { serializeIdMaps, deserializeIdMaps };
