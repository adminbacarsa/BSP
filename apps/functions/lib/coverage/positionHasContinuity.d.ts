import type { Firestore } from 'firebase-admin/firestore';
export declare function positionHasContinuityFromSlaDoc(slaDoc: Record<string, unknown> | null | undefined, positionName: string, shiftEndTime: Date, outgoingCode?: unknown): boolean;
export declare function nextBandSlotsFromSlaDoc(slaDoc: Record<string, unknown> | null | undefined, positionName: string, shiftEndTime: Date, outgoingCode?: unknown): number | null;
export declare function loadPositionHasContinuity(db: Firestore, objectiveId: string, positionName: string, shiftEndTime: Date, outgoingCode?: unknown): Promise<boolean>;
