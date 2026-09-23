import type { Firestore } from 'firebase-admin/firestore';
export declare function positionHasContinuityFromSlaDoc(slaDoc: Record<string, unknown> | null | undefined, positionName: string, shiftEndTime: Date): boolean;
export declare function loadPositionHasContinuity(db: Firestore, objectiveId: string, positionName: string, shiftEndTime: Date): Promise<boolean>;
