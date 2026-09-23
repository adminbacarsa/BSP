import { type Firestore } from 'firebase-admin/firestore';
declare const RETENTION_MAX_TOTAL_MS: number;
export type RetainOutgoingOpts = {
    sendPush?: boolean;
    reportedBy?: string;
};
export type RetainOutgoingResult = {
    applied: boolean;
    shiftIds: string[];
    employeeNames: string[];
    skippedReason?: string;
};
export declare function retainOutgoingForGap(db: Firestore, titularShift: Record<string, unknown> & {
    id?: string;
}, opts?: RetainOutgoingOpts): Promise<RetainOutgoingResult>;
export declare function releaseRetentionForAbsenceShift(db: Firestore, absenceShiftId: string, releasedBy: string): Promise<number>;
export declare function totalShiftMs(data: Record<string, unknown>, nowMs: number): number;
export { RETENTION_MAX_TOTAL_MS };
export type ReleaseInvalidRetentionRow = {
    shiftId: string;
    employeeName: string;
    objectiveId: string;
    reason: string;
    action: 'would_release' | 'released';
};
export declare function releaseInvalidRetentionsRun(db: Firestore, opts: {
    empresaId?: string;
    dryRun?: boolean;
}): Promise<{
    rows: ReleaseInvalidRetentionRow[];
}>;
export declare function applyAutoRetentionForAbsenceShift(db: Firestore, absenceShiftId: string, absenceData: Record<string, unknown>): Promise<{
    applied: boolean;
    shiftId?: string;
    employeeName?: string;
}>;
