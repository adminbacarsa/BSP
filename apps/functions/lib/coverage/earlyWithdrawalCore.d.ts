import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { EarlyWithdrawReason, EarlyWithdrawReplacePolicy } from './earlyWithdrawPolicy';
export type ProcessEarlyWithdrawInput = {
    shiftId: string;
    reason: EarlyWithdrawReason;
    operatorReplaceChoice?: boolean | null;
    resolvedBy?: 'OPERACIONES' | 'AUTO';
    actorUid?: string | null;
    actorName?: string | null;
    now?: Timestamp;
};
export type ProcessEarlyWithdrawResult = {
    ok: boolean;
    policy: EarlyWithdrawReplacePolicy;
    hoursLeft: number;
    outgoingShiftClosed: boolean;
    remainderShiftId: string | null;
    cascadeStarted: boolean;
    escalated: boolean;
    retained: boolean;
    error?: string;
};
export declare function processEarlyWithdrawal(db: admin.firestore.Firestore, input: ProcessEarlyWithdrawInput): Promise<ProcessEarlyWithdrawResult>;
