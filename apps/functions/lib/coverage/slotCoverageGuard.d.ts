import * as admin from 'firebase-admin';
import { type WriteBatch, type Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
export declare function normalizePosMatch(n: unknown): string;
export declare function isNoPlanningVacancyOrigin(data: Record<string, unknown> | null | undefined): boolean;
export declare function resolveSlotRequiredQuantity(data: Record<string, unknown> | null | undefined): number;
export type SlotRef = {
    objectiveId: string;
    positionName?: string | null;
    startTime?: Timestamp | null;
    endTime?: Timestamp | null;
    empresaId?: string | null;
    excludeShiftIds?: string[];
    requiredQuantity?: number | null;
};
export type SlotCoverageStatus = {
    covered: number;
    required: number;
    saturated: boolean;
    covererNames: string[];
};
export declare function slotCoverageStatus(db: admin.firestore.Firestore, slot: SlotRef): Promise<SlotCoverageStatus>;
export declare function slotAlreadyHasCoverer(db: admin.firestore.Firestore, slot: SlotRef): Promise<{
    saturated: boolean;
    covererNames: string[];
    covered: number;
    required: number;
}>;
export declare function closeSiblingNoPlanningVacancies(db: admin.firestore.Firestore, opts: {
    coveredVacancyId: string;
    objectiveId: string;
    positionName?: string | null;
    startTime?: Timestamp | null;
    empresaId?: string | null;
    covererEmployeeId?: string | null;
    covererEmployeeName?: string | null;
    coverageEventId?: string | null;
    resolvedBy?: string | null;
    requiredQuantity?: number | null;
}): Promise<number>;
export declare function queueCloseSiblingVacanciesInBatch(batch: WriteBatch, siblingDocs: QueryDocumentSnapshot[], opts: {
    coveredVacancyId: string;
    covererEmployeeId?: string | null;
    covererEmployeeName?: string | null;
    coverageEventId?: string | null;
    resolvedBy?: string | null;
    positionName?: string | null;
}): string[];
