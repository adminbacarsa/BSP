import { type Firestore } from 'firebase-admin/firestore';
export type ReleaseTraceAbsencesRow = {
    shiftId: string;
    employeeName: string;
    action: 'would_revert' | 'reverted';
};
export declare function releaseTraceAbsencesRun(db: Firestore, opts: {
    empresaId?: string;
    dryRun?: boolean;
}): Promise<{
    rows: ReleaseTraceAbsencesRow[];
}>;
