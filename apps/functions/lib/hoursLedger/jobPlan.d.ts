export declare const LEDGER_CHUNK_SIZE = 10;
export declare const LEDGER_PARALLEL = 3;
export type ChunkMark = 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR';
export type LedgerChunk = {
    start: number;
    end: number;
    status: ChunkMark;
    error?: string;
};
export declare function buildChunks(total: number, size?: number): LedgerChunk[];
export declare function claimChunks(chunks: LedgerChunk[], parallel?: number): number[];
export declare function markChunk(chunks: LedgerChunk[], index: number, status: 'DONE' | 'ERROR', error?: string): LedgerChunk[];
export declare function processedOf(chunks: LedgerChunk[]): number;
export declare function progressPct(processed: number, total: number): number;
export declare function simulateJob(total: number, size?: number, parallel?: number): {
    processed: number;
    total: number;
    pct: number;
    waves: number;
    chunkCount: number;
    maxChunk: number;
    pending: number;
};
