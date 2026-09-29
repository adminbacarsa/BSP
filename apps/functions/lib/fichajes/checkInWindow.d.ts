export type CheckInWindowResult = {
    allowed: boolean;
    rejectCode?: 'ABSENT' | 'TRACE_REGISTRATION' | 'TOO_EARLY' | 'TOO_LATE' | 'SHIFT_ENDED' | 'EXT_NO_CHECKIN';
    usePlannedStart?: boolean;
    useAdjustedStart?: boolean;
    lateMinutes?: number;
    lateNoNotice?: boolean;
};
export declare function convocadoPunchAnchorMs(shift: Record<string, unknown>): number;
export declare function convocadoPunchCapMs(shift: Record<string, unknown>): number;
export declare function evaluateServerCheckInWindow(shift: Record<string, unknown>, nowMs: number, opts?: {
    source?: string;
}): CheckInWindowResult;
