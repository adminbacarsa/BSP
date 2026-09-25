import type { Firestore } from 'firebase-admin/firestore';
export declare const RELEVO_GAP_ALIGN_MS: number;
export declare const posMatchRelief: (a: unknown, b: unknown) => boolean;
export type OutgoingReliefPick = {
    id: string;
    data: Record<string, unknown>;
};
export declare function findPresentOutgoingAlignedToGapStart(db: Firestore, params: {
    objectiveId: string;
    positionName: unknown;
    gapStartMs: number;
    excludeShiftIds?: string[];
    excludeEmployeeId?: string;
}): Promise<OutgoingReliefPick | null>;
