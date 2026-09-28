import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { type AcceptanceCheck, type BuildCoverageCandidatesInput, type CoverageCandidateRow, type CoverageCascadeType } from './coverageCandidates';
export type CascadeConvLike = {
    empresaId: string;
    shiftId: string;
    objectiveId: string;
    clientId?: string;
    positionName?: string;
    shiftCode?: string;
    startTime?: Timestamp;
    endTime?: Timestamp;
    aptitudesRequeridas?: string[];
    candidateEmployeeId?: string;
};
export declare function loadCoverageCandidateInput(db: admin.firestore.Firestore, conv: CascadeConvLike, opts?: {
    purpose?: 'select' | 'accept';
    titular?: Record<string, unknown>;
}): Promise<BuildCoverageCandidatesInput>;
export declare function findBestCoverageCandidate(db: admin.firestore.Firestore, conv: CascadeConvLike, type: CoverageCascadeType): Promise<{
    row: CoverageCandidateRow;
    uid?: string;
} | null>;
export declare function listFtCandidates(db: admin.firestore.Firestore, conv: CascadeConvLike, limit: number): Promise<{
    row: CoverageCandidateRow;
    uid?: string;
}[]>;
export declare function revalidateAcceptance(db: admin.firestore.Firestore, conv: CascadeConvLike & {
    type: string;
    extendShiftId?: string;
    advanceShiftId?: string;
    candidateShiftId?: string;
    ftShiftId?: string;
}, purpose?: 'select' | 'accept'): Promise<AcceptanceCheck>;
