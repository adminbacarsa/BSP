export declare const CRON_V1_RUNTIME: {
    timeoutSeconds: number;
    memory: "512MB";
};
export declare const CRON_QUERY_MAX_DOCS = 250;
export declare const CRON_BATCH_WRITE_LIMIT = 400;
export declare const CRON_MAX_WALL_MS: number;
export declare function cronShouldStop(startedAtMs: number, maxWallMs?: number): boolean;
export declare function commitBatchIfNeeded(db: FirebaseFirestore.Firestore, batch: FirebaseFirestore.WriteBatch, opCount: number): Promise<{
    batch: FirebaseFirestore.WriteBatch;
    opCount: number;
}>;
