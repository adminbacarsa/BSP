export declare const PAY_ON_TIME_GRACE_MS: number;
export type CheckInPayClock = {
    checkInAtMs: number;
    realStartMs: number;
    isLate: boolean;
    lateMinutes: number;
};
export declare function resolveCheckInPayClock(input: {
    nowMs: number;
    plannedStartMs: number;
    windowLateMinutes?: number;
}): CheckInPayClock;
