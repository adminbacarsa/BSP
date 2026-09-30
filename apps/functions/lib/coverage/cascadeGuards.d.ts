export declare const CASCADE_LOCK_MS: number;
export declare function cascadeLockHeld(lockAtMs: number, nowMs: number): boolean;
export declare function shouldAdvanceOnReject(previousStatus: unknown): boolean;
export declare function toMillisLoose(value: unknown): number;
