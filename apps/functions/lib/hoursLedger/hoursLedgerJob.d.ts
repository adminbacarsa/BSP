export declare function hoursLedgerJobDocId(empresaId: string, period: string, dryRun: boolean): string;
export declare function enqueueHoursLedgerJob(opts: {
    empresaId: string;
    period?: string;
    dryRun?: boolean;
    createdBy?: string;
    uid?: string;
    force?: boolean;
}): Promise<{
    jobId: string;
    queued: boolean;
    reused: boolean;
    period: string;
    dryRun: boolean;
}>;
export declare function retryHoursLedgerJob(jobId: string): Promise<{
    jobId: string;
    queued: boolean;
    retry: boolean;
}>;
export declare function enqueueOpenMonthAllEmpresas(): Promise<{
    period: string;
    jobs: string[];
}>;
export declare function stepHoursLedgerJob(jobId: string): Promise<void>;
