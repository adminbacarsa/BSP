export type CheckInWindowResult = {
    allowed: boolean;
    rejectCode?: 'ABSENT' | 'TRACE_REGISTRATION' | 'TOO_EARLY' | 'TOO_LATE' | 'SHIFT_ENDED';
    usePlannedStart?: boolean;
    lateMinutes?: number;
};
export declare function evaluateServerCheckInWindow(shift: Record<string, unknown>, nowMs: number, opts?: {
    source?: string;
    ownShiftWindowMs?: number;
}): CheckInWindowResult;
