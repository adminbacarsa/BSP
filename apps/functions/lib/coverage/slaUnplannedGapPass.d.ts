import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
export type SlaUnplannedGapDoc = {
    id?: string;
    empresaId: string;
    objectiveId: string;
    objectiveName?: string;
    clientId?: string;
    clientName?: string;
    positionName: string;
    bandCode?: string;
    gapStart: Timestamp;
    gapEnd: Timestamp;
    planningNotifiedAt?: Timestamp | null;
    ccVacancyShiftId?: string | null;
    retentionAppliedAt?: Timestamp | null;
    status?: 'OPEN' | 'CLOSED';
};
export declare function advanceSlaUnplannedGap(db: admin.firestore.Firestore, gap: SlaUnplannedGapDoc, now?: Timestamp): Promise<{
    phase: string;
    shiftId?: string;
}>;
export declare function runSlaUnplannedGapPass(db: admin.firestore.Firestore, opts?: {
    empresaId?: string;
    limit?: number;
}): Promise<number>;
