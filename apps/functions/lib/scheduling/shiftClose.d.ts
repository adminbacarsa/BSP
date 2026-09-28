import { Timestamp } from 'firebase-admin/firestore';
export declare const SHIFT_HARD_CAP_MS: number;
export declare const STALE_CAP_GRACE_MS: number;
export declare function shiftWorkStartMs(data: Record<string, unknown>): number;
export declare function shiftHardCapAtMs(data: Record<string, unknown>): number;
export type AutoCloseOpts = {
    realEndMs: number;
    reason: string;
    now: Timestamp;
    by?: string;
    extra?: Record<string, unknown>;
};
export declare function buildAutoClosePatch(data: Record<string, unknown>, opts: AutoCloseOpts): Record<string, unknown>;
