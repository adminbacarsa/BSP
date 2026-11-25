import { Timestamp } from 'firebase-admin/firestore';
import { SHIFT_HARD_CAP_MS, STALE_CAP_GRACE_MS, shiftHardCapAtMs, shiftWorkStartMs } from './shiftCloseCore';
export { SHIFT_HARD_CAP_MS, STALE_CAP_GRACE_MS, shiftHardCapAtMs, shiftWorkStartMs };
export type AutoCloseOpts = {
    realEndMs: number;
    reason: string;
    now: Timestamp;
    by?: string;
    extra?: Record<string, unknown>;
};
export declare function buildAutoClosePatch(data: Record<string, unknown>, opts: AutoCloseOpts): Record<string, unknown>;
export declare function clearRetentionOnReliefClose(patch: Record<string, unknown>): Record<string, unknown>;
