export declare function parsePeriod(period: string, now?: Date): {
    year: number;
    month: number;
    periodKey: string;
};
export declare function rebuildHoursLedger(opts: {
    empresaId: string;
    period?: string;
    dryRun?: boolean;
}): Promise<{
    dryRun: boolean;
    empresaId: string;
    periodKey: string;
    hoursCoreEnabled: boolean;
    totals: Record<string, number>;
    monthly: any[];
    days: any[];
    counts: {
        days: number;
        monthly: number;
    };
}>;
export declare function markLedgerDirty(opts: {
    empresaId: string;
    objectiveId?: string;
    periodKey?: string;
}): Promise<void>;
export declare function runDueLedgerDirty(limit?: number): Promise<{
    processed: number;
    months: number;
}>;
export declare function rebuildOpenMonthAllEmpresas(): Promise<{
    period: string;
    empresas: string[];
}>;
